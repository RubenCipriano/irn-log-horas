using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Domain.Holidays;
using TimeFlow.Domain.Schedule;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/members/{userId}/summary — rolled-up read for the
// `/members/[userId]` page in the SPA. Composes four things the
// frontend would otherwise stitch via four round trips:
//
//   1. The target's directory row (profile + role + org cost rate)
//   2. Their project memberships (with nearest-ancestor-wins rate cascade,
//      gated to billing-readers)
//   3. A work-hours block for the chosen month (hours logged, expected,
//      deficit, billable, paycheck)
//   4. A per-project hours/paycheck breakdown + the last 20 worklog rows
//      to seed the mini calendar without a second hit
//
// Visibility is tiered via per-section nulling rather than 403-ing the
// whole payload — the directory entry must stay readable for plain
// viewers, so we keep returning 200 and just blank the gated sections:
//
//   * Profile + project memberships list: MembersRead (Viewer+, enforced
//     by the route-level filter)
//   * Bill rate / cost rate inside the memberships rows AND the paycheck
//     stat AND the billed stat: PermissionMatrix.Can(role, BillingRead)
//   * Hours block + per-project rows + recentWorklogs: caller is the
//     target (WorklogsReadOwn) OR WorklogsReadOrg
//
// Paycheck math = sum(hours * effective cost_per_hour). Effective rate
// cascades nearest-ancestor-wins exactly like HoursSummary
// (project_members.cost_per_hour up the project tree -> org_memberships.
// cost_per_hour). For worklogs already attached to an InvoiceLine we
// prefer the FROZEN invoice_line.bill_rate so a post-invoice rate change
// can't silently rewrite historical paychecks. Worklogs whose effective
// rate is null are summed into HoursUnrated and excluded from paycheck.
public static class MemberSummaryEndpoints {
    public static void MapMemberSummaryEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/members").RequireAuthorization();
        // MembersRead is the OUTER gate (route-level). Per-section
        // tightening happens inside the handler — hours need
        // WorklogsReadOwn/Org, monetary fields need BillingRead.
        grp.MapGet("/{userId:guid}/summary", Summary).RequireOrgPermission(Permission.MembersRead);
        // Raw worklog stream for the mini-calendar grid. Mirrors
        // WorklogEndpoints.List but pins target = userId so the gate
        // is explicit (the caller-scoped /worklogs handler silently
        // coerces target to caller when role is insufficient).
        grp.MapGet("/{userId:guid}/worklogs", ListMemberWorklogs).RequireOrgPermission(Permission.MembersRead);
    }

    public sealed record MemberProfile(
        Guid Id, string Email, string Name, string Role, DateTime JoinedAt,
        decimal? OrgCostPerHour,
        // Compensation block — gated by canSeeBilling. PayCadence echoes
        // the normalised cadence value ('hourly'/'daily'/'monthly'); the
        // three rate slots are persisted alongside it so the editor can
        // remember each one when the cadence toggles.
        string? PayCadence,
        decimal? HourlyRate,
        decimal? DailyRate,
        decimal? MonthlyRate);

    public sealed record ProjectMembershipItem(
        Guid ProjectId, string ProjectName, string? ProjectCode,
        string RoleOnProject,
        decimal? BillRate, decimal? CostPerHour,
        DateTime JoinedAt);

    public sealed record WorkSummaryBlock(
        decimal HoursLogged,
        decimal HoursExpected,
        decimal Deficit,
        decimal BillableHours,
        decimal HoursUnrated,
        decimal BillableHoursUnrated,
        decimal? Paycheck,
        decimal? Billed,
        decimal? Revenue);

    public sealed record PerProjectRow(
        Guid ProjectId, string ProjectName,
        decimal Hours, decimal BillableHours,
        decimal? Paycheck,
        decimal? Revenue,
        decimal? EffectiveBillRate);

    public sealed record RecentWorklogRow(
        Guid Id, Guid? ProjectId, Guid? TaskId,
        DateOnly WorkDate, decimal Hours,
        string? Notes, bool IsBillable, string BillingStatus,
        DateTime CreatedAt);

    public sealed record MemberSummaryResponse(
        MemberProfile Member,
        IReadOnlyList<ProjectMembershipItem> ProjectMemberships,
        WorkSummaryBlock? WorkSummary,
        IReadOnlyList<PerProjectRow>? PerProject,
        IReadOnlyList<RecentWorklogRow>? RecentWorklogs,
        DateOnly From,
        DateOnly To);

    // Internal cache payload — every dimension that changes the result
    // (visibility flags, month window) goes into the cache key, and the
    // payload holds the materialised section data so we don't re-run the
    // joins per call. Stored as concrete lists/records so JSON round-trip
    // through Redis is well-defined.
    private sealed record MemberSummaryPayload(
        MemberProfile Member,
        List<ProjectMembershipItem> ProjectMemberships,
        WorkSummaryBlock? WorkSummary,
        List<PerProjectRow>? PerProject,
        List<RecentWorklogRow>? RecentWorklogs,
        DateOnly From,
        DateOnly To);

    // -----------------------------------------------------------------
    // GET /api/orgs/{id}/members/{userId}/summary?month=YYYY-MM
    // -----------------------------------------------------------------
    public static async Task<IResult> Summary(
        Guid id, Guid userId,
        string? month,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, callerRole) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        if (callerId is null) return Results.Unauthorized();

        var (fromDate, toDate) = ResolveMonth(month);

        // Section gates. We resolve them BEFORE the cache lookup because
        // the visible payload differs per viewer bucket — a Viewer's
        // cached entry (workSummary=null) must not be served to a Manager.
        var isSelf = callerId.Value == userId;
        var canSeeWork = isSelf
            ? PermissionMatrix.Can(callerRole, Permission.WorklogsReadOwn)
            : PermissionMatrix.Can(callerRole, Permission.WorklogsReadOrg);
        // Monetary fields piggy-back on the billing-read gate so a future
        // bump (Manager -> Admin) propagates without a code change.
        var canSeeBilling = PermissionMatrix.Can(callerRole, Permission.BillingRead);
        var viewerBucket = $"{(canSeeWork ? 'w' : '-')}{(canSeeBilling ? 'b' : '-')}";
        var yyyyMM = $"{fromDate.Year:D4}{fromDate.Month:D2}";

        var payload = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:member:{userId:N}:summary:{yyyyMM}:{viewerBucket}",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] {
                MembershipCacheTags.OrgMembers(orgId),
                $"org:{orgId:N}:worklogs",
                $"org:{orgId:N}:projects",
                MembershipCacheTags.OrgPolicy(orgId),
            },
            loader: async ct2 => await LoadSummaryAsync(
                db, orgId, userId, fromDate, toDate,
                canSeeWork, canSeeBilling, ct2),
            ct: ct);

        // Null payload = target user is not a member of this org. We
        // 404 — DON'T leak by returning an empty 200, mirrors the
        // existing HoursSummary behaviour.
        if (payload is null) return Results.NotFound();

        return Results.Ok(new MemberSummaryResponse(
            payload.Member,
            payload.ProjectMemberships,
            payload.WorkSummary,
            payload.PerProject,
            payload.RecentWorklogs,
            payload.From,
            payload.To));
    }

    // -----------------------------------------------------------------
    // GET /api/orgs/{id}/members/{userId}/worklogs?from=&to=&projectId=
    // -----------------------------------------------------------------
    // Per-member worklog stream feeding the mini-calendar on the detail
    // page. Pinned target = userId by design — the caller-scoped
    // /worklogs handler silently downgrades target to caller on
    // insufficient role, which would mask permission errors here.
    public static async Task<IResult> ListMemberWorklogs(
        Guid id, Guid userId,
        DateOnly? from, DateOnly? to, Guid? projectId,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        if (callerId is null) return Results.Unauthorized();

        if (userId != callerId.Value
            && !PermissionMatrix.Can(role, Permission.WorklogsReadOrg)) {
            return Results.Forbid();
        }

        var fromDate = from ?? new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        var toDate = to ?? fromDate.AddMonths(1).AddDays(-1);
        if (toDate < fromDate) return Results.Json(new { error = "to < from." }, statusCode: 400);
        if ((toDate.DayNumber - fromDate.DayNumber) > 366) {
            return Results.Json(new { error = "Range too wide (max 1 year)." }, statusCode: 400);
        }

        // Same subtree expansion as WorklogEndpoints.List — engagement-
        // level filter must include all descendant projects.
        List<Guid>? projectScope = null;
        if (projectId is { } pid) {
            projectScope = await ProjectTreeHelper.DescendantProjectIdsAsync(db, orgId, pid, ct);
            if (projectScope.Count == 0) {
                return Results.Ok(Array.Empty<WorklogEndpoints.WorklogItem>());
            }
        }

        var projectKey = projectId is { } pk ? pk.ToString("N") : "all";
        var cacheKey = $"org:{orgId:N}:member-worklogs:{userId:N}:p:{projectKey}:{fromDate:yyyyMMdd}:{toDate:yyyyMMdd}";
        var logs = await cache.GetOrSetAsync(
            key: cacheKey,
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:worklogs" },
            loader: async ct2 => {
                var q = db.Worklogs
                    .Where(w => w.OrgId == orgId && w.UserId == userId
                        && w.WorkDate >= fromDate && w.WorkDate <= toDate);
                if (projectScope is not null) {
                    q = q.Where(w =>
                        (w.ProjectId != null && projectScope.Contains(w.ProjectId.Value))
                        || (w.TaskId != null && db.NativeTasks
                            .Any(t => t.Id == w.TaskId && projectScope.Contains(t.ProjectId))));
                }
                return await q
                    .OrderBy(w => w.WorkDate).ThenBy(w => w.CreatedAt)
                    .Select(w => new WorklogEndpoints.WorklogItem(
                        w.Id, w.UserId,
                        w.ProjectId, w.TaskId,
                        w.ProjectId != null
                            ? db.NativeProjects.Where(p => p.Id == w.ProjectId)
                                .Select(p => p.UpstreamProjectId).FirstOrDefault()
                            : (w.TaskId != null
                                ? db.NativeTasks.Where(t => t.Id == w.TaskId)
                                    .Select(t => db.NativeProjects
                                        .Where(p => p.Id == t.ProjectId)
                                        .Select(p => p.UpstreamProjectId)
                                        .FirstOrDefault())
                                    .FirstOrDefault()
                                : null),
                        w.WorkDate, w.Hours, w.Notes, w.Source,
                        w.PushStatus, w.UpstreamWorklogId, w.PushErrorCode,
                        w.CreatedAt,
                        w.IsBillable,
                        w.InvoiceLineId != null ? "billed"
                            : (w.IsBillable ? "billable" : "non_billable")))
                    .ToListAsync(ct2);
            },
            ct: ct);

        return Results.Ok(logs);
    }

    // Pulls month from the optional `?month=YYYY-MM` query param. UTC now
    // is the fallback so caches stay deterministic across the cluster.
    private static (DateOnly from, DateOnly to) ResolveMonth(string? month) {
        var now = DateTime.UtcNow;
        if (!string.IsNullOrWhiteSpace(month)
            && month.Length == 7
            && month[4] == '-'
            && int.TryParse(month.AsSpan(0, 4), out var yy)
            && int.TryParse(month.AsSpan(5, 2), out var mm)
            && mm is >= 1 and <= 12
            && yy is >= 1900 and <= 2200) {
            var first = new DateOnly(yy, mm, 1);
            return (first, first.AddMonths(1).AddDays(-1));
        }
        var fallback = new DateOnly(now.Year, now.Month, 1);
        return (fallback, fallback.AddMonths(1).AddDays(-1));
    }

    private static async Task<MemberSummaryPayload?> LoadSummaryAsync(
        TimeFlowDbContext db, Guid orgId, Guid userId,
        DateOnly fromDate, DateOnly toDate,
        bool canSeeWork, bool canSeeBilling,
        CancellationToken ct) {
        // Profile + org membership. Missing row = not a member of this
        // org — let the caller turn that into a 404.
        var membership = await (
            from m in db.OrgMemberships.AsNoTracking()
            join u in db.Users.AsNoTracking() on m.UserId equals u.Id
            where m.OrgId == orgId && m.UserId == userId
            select new {
                m.UserId, u.Email, u.Name, m.Role, m.CreatedAt,
                m.CostPerHour, m.PayCadence, m.DailyRate, m.MonthlyRate,
            }
        ).FirstOrDefaultAsync(ct);
        if (membership is null) return null;

        // Normalize the cadence sentinel: a NULL pay_cadence row is the
        // backwards-compat "hourly" case. Persisting NULL on disk stays
        // legitimate (existing rows pre-cadence column); the math always
        // operates on a concrete cadence value.
        var cadence = (membership.PayCadence ?? "hourly").Trim().ToLowerInvariant();
        if (cadence is not ("hourly" or "daily" or "monthly")) cadence = "hourly";

        var profile = new MemberProfile(
            membership.UserId, membership.Email, membership.Name,
            membership.Role, membership.CreatedAt,
            // Even on the profile row, the org-level cost rate is HR
            // adjacent — strip below billing-read.
            canSeeBilling ? membership.CostPerHour : null,
            // Compensation block also HR-adjacent — same gate.
            // HourlyRate aliases CostPerHour: the existing column is the
            // canonical hourly slot, the new daily/monthly columns sit
            // beside it and the cadence picks which one drives paycheck.
            canSeeBilling ? cadence : null,
            canSeeBilling ? membership.CostPerHour : null,
            canSeeBilling ? membership.DailyRate : null,
            canSeeBilling ? membership.MonthlyRate : null);

        // Project memberships are ALWAYS listed (it's a directory view) —
        // only the monetary columns get nulled below billing-read. We
        // filter denied=true rows out: per plan-016 semantics denied
        // means "no access," and a directory advertising 'projects he
        // works on' should not include explicit blocks.
        var memberships = await (
            from pm in db.ProjectMembers.AsNoTracking()
            join p in db.NativeProjects.AsNoTracking() on pm.ProjectId equals p.Id
            where pm.OrgId == orgId && pm.UserId == userId && !pm.Denied
            orderby p.Name
            select new {
                p.Id, p.Name, p.Code,
                pm.RoleOnProject, p.BillRate, pm.CostPerHour, pm.AllocatedAt,
            }
        ).ToListAsync(ct);

        var projectMemberships = memberships.Select(r => new ProjectMembershipItem(
            ProjectId: r.Id,
            ProjectName: r.Name,
            ProjectCode: r.Code,
            RoleOnProject: r.RoleOnProject,
            BillRate: canSeeBilling ? r.BillRate : null,
            CostPerHour: canSeeBilling ? r.CostPerHour : null,
            JoinedAt: r.AllocatedAt)).ToList();

        // Without WorklogsRead, we stop here — the directory entry +
        // project list are still useful for a Viewer.
        if (!canSeeWork) {
            return new MemberSummaryPayload(
                profile, projectMemberships,
                WorkSummary: null, PerProject: null, RecentWorklogs: null,
                fromDate, toDate);
        }

        // ---------- Worklogs in window ----------
        var monthLogs = await db.Worklogs.AsNoTracking()
            .Where(w => w.OrgId == orgId && w.UserId == userId
                && w.WorkDate >= fromDate && w.WorkDate <= toDate)
            .Select(w => new {
                w.Id, w.ProjectId, w.TaskId, w.WorkDate, w.Hours,
                w.Notes, w.IsBillable, w.InvoiceLineId, w.CreatedAt,
            })
            .ToListAsync(ct);

        // ---------- Rate cascade ----------
        // Mirrors HoursSummary's WalkRate logic verbatim so paycheck on
        // /summary lines up with the per-project totals on /hours-summary.
        // Step 1: per-project cost overrides for THIS user.
        var overrides = await db.ProjectMembers.AsNoTracking()
            .Where(pm => pm.OrgId == orgId && pm.UserId == userId && pm.CostPerHour != null)
            .ToDictionaryAsync(pm => pm.ProjectId, pm => pm.CostPerHour!.Value, ct);

        // Step 2: project metadata for every project touched (worklog OR
        // override) so the ancestor walk has a starting node either way.
        var projectIdsTouched = new HashSet<Guid>(
            monthLogs.Where(w => w.ProjectId is Guid).Select(w => w.ProjectId!.Value));
        foreach (var pid in overrides.Keys) projectIdsTouched.Add(pid);

        var projectMeta = await db.NativeProjects.AsNoTracking()
            .Where(p => p.OrgId == orgId && projectIdsTouched.Contains(p.Id))
            .Select(p => new { p.Id, p.Name, p.ParentProjectId, p.BillRate, p.DefaultBillRate })
            .ToDictionaryAsync(p => p.Id, ct);

        // Step 3: expand parent_of with ancestors that don't appear in
        // the worklog set — the walk needs to reach the engagement.
        var parentOf = projectMeta.Values
            .ToDictionary(p => p.Id, p => p.ParentProjectId);
        var seen = new HashSet<Guid>(parentOf.Keys);
        var frontier = parentOf.Values.OfType<Guid>().Where(p => !seen.Contains(p)).ToList();
        while (frontier.Count > 0) {
            var more = await db.NativeProjects.AsNoTracking()
                .Where(p => p.OrgId == orgId && frontier.Contains(p.Id))
                .Select(p => new { p.Id, p.Name, p.ParentProjectId, p.BillRate, p.DefaultBillRate })
                .ToListAsync(ct);
            var next = new List<Guid>();
            foreach (var a in more) {
                parentOf[a.Id] = a.ParentProjectId;
                projectMeta[a.Id] = new { a.Id, a.Name, a.ParentProjectId, a.BillRate, a.DefaultBillRate };
                seen.Add(a.Id);
                if (a.ParentProjectId is Guid pid && !seen.Contains(pid)) next.Add(pid);
            }
            frontier = next;
        }

        decimal? WalkRate(Guid leafProjectId) {
            var cursor = (Guid?)leafProjectId;
            // Guard against a malformed cycle in parent_project_id (the
            // I7 check rejects this at write time, but be defensive on
            // the read path).
            var guard = 0;
            while (cursor is Guid pid && guard++ < 64) {
                if (overrides.TryGetValue(pid, out var rate)) return rate;
                cursor = parentOf.GetValueOrDefault(pid);
            }
            return null;
        }
        var orgRate = membership.CostPerHour;

        // ---------- Invoice-line rate snapshot ----------
        // Hours already attached to an invoice line use the FROZEN
        // bill_rate (InvoiceEndpoints freezes it at generate time). This
        // keeps historical paychecks stable when an admin edits a rate
        // post-invoice.
        var invoiceLineIds = monthLogs
            .Where(w => w.InvoiceLineId is Guid)
            .Select(w => w.InvoiceLineId!.Value)
            .Distinct()
            .ToList();
        var invoiceLineRate = invoiceLineIds.Count == 0
            ? new Dictionary<Guid, decimal>()
            : await db.InvoiceLines.AsNoTracking()
                .Where(l => invoiceLineIds.Contains(l.Id))
                .ToDictionaryAsync(l => l.Id, l => l.BillRate, ct);

        decimal? EffectiveRate(Guid? projectId, Guid? invoiceLineId) {
            if (invoiceLineId is Guid lid && invoiceLineRate.TryGetValue(lid, out var frozen)) {
                return frozen;
            }
            if (projectId is Guid pid) return WalkRate(pid) ?? orgRate;
            return orgRate;
        }

        // ---------- Bill-rate cascade (revenue side) ----------
        // Mirrors InvoiceEndpoints.GatherCandidateLinesAsync (514, 566-567)
        // so the per-member revenue display reconciles with how invoices
        // would actually be priced. The cascade walks from the worklog's
        // project up the tree:
        //   1. project_members.cost_per_hour for (ancestor, userId)
        //      — same column the invoice walker uses; in this codebase
        //        `cost_per_hour` on a ProjectMember IS the per-member
        //        bill-rate override (InvoiceEndpoints reads it as the
        //        resolved rate fed straight into invoice_line.bill_rate).
        //   2. project.bill_rate walking from leaf up
        //   3. project.default_bill_rate walking from leaf up
        // Frozen invoice_line.bill_rate wins over the live cascade for
        // already-invoiced worklogs — same snapshot rule as paycheck.
        decimal? WalkBillRate(Guid leafProjectId) {
            var cursor = (Guid?)leafProjectId;
            var guard = 0;
            // Step 1: nearest-ancestor project_members.cost_per_hour for
            // THIS user. `overrides` is already keyed by ProjectId for
            // userId (loaded above).
            while (cursor is Guid pid && guard++ < 64) {
                if (overrides.TryGetValue(pid, out var rate)) return rate;
                cursor = parentOf.GetValueOrDefault(pid);
            }
            // Step 2: nearest-ancestor project.bill_rate.
            cursor = leafProjectId;
            guard = 0;
            while (cursor is Guid pid && guard++ < 64) {
                if (projectMeta.TryGetValue(pid, out var meta) && meta.BillRate is decimal br) {
                    return br;
                }
                cursor = parentOf.GetValueOrDefault(pid);
            }
            // Step 3: nearest-ancestor project.default_bill_rate.
            cursor = leafProjectId;
            guard = 0;
            while (cursor is Guid pid && guard++ < 64) {
                if (projectMeta.TryGetValue(pid, out var meta) && meta.DefaultBillRate is decimal dbr) {
                    return dbr;
                }
                cursor = parentOf.GetValueOrDefault(pid);
            }
            return null;
        }

        decimal? EffectiveBillRate(Guid? projectId, Guid? invoiceLineId) {
            // Frozen snapshot wins — the rate that was actually invoiced.
            if (invoiceLineId is Guid lid && invoiceLineRate.TryGetValue(lid, out var frozen)) {
                return frozen;
            }
            if (projectId is Guid pid) return WalkBillRate(pid);
            return null;
        }

        // ---------- Aggregates ----------
        // Per-project tuple carries paycheck (cost side) and revenue (bill
        // side) plus a (hours, revenue) sample pair so the displayed
        // EffectiveBillRate is a weighted-avg blending frozen invoice-line
        // snapshots with the live cascade — divides out as
        // sumRevenue / sumBillableHours.
        var perProjectAccum = new Dictionary<Guid,
            (decimal hours, decimal billable,
             decimal? paycheck,
             decimal? revenue,
             decimal rateSampleHours, decimal rateSampleRevenue)>();
        decimal hoursLogged = 0m;
        decimal billableHours = 0m;
        decimal hoursUnrated = 0m;
        decimal billableHoursUnrated = 0m;
        decimal paycheck = 0m;
        decimal billed = 0m;
        decimal revenue = 0m;

        // Cadence-aware paycheck math.
        //
        //   * "hourly" (default + legacy NULL): Σ(hours × effectiveCostRate)
        //     with the rate cascade (frozen invoice-line snapshot > per-project
        //     override > org rate). Per-project paycheck is meaningful and we
        //     attribute by project.
        //   * "daily":  distinctWorkdays × dailyRate. Per-worklog rate-cascade
        //     is BYPASSED (decision 5). Per-project paycheck is set to NULL —
        //     the daily rate is org-level and there's no clean attribution
        //     across projects worked on the same day.
        //   * "monthly": monthlyRate × (hoursLogged / expectedHours), guarded
        //     against expectedHours==0 (returns NULL paycheck rather than div/0).
        //     Per-project paycheck is also NULL — pro-ration is window-wide.
        //
        // For daily/monthly cadences, the revenue (bill-rate) side is still
        // computed exactly as for hourly — bill-rate is a customer-billing
        // figure independent of how the org chooses to PAY the member.
        // HoursUnrated/BillableHoursUnrated semantics: HoursUnrated counts
        // worklogs without a resolvable COST rate; that warning is only
        // useful under hourly cadence (the org-level monthly/daily rate is
        // the only knob in those modes), so we suppress it for daily/monthly.
        var isHourly = cadence == "hourly";

        foreach (var w in monthLogs) {
            hoursLogged += w.Hours;
            if (w.IsBillable) billableHours += w.Hours;
            // Revenue side runs in ALL cadences — invoicing is decoupled
            // from how the member is paid.
            decimal? billRate = null;
            decimal rowRevenue = 0m;
            if (w.IsBillable) {
                billRate = EffectiveBillRate(w.ProjectId, w.InvoiceLineId);
                if (billRate is decimal br) {
                    rowRevenue = w.Hours * br;
                    revenue += rowRevenue;
                } else {
                    billableHoursUnrated += w.Hours;
                }
            }

            if (isHourly) {
                var rate = EffectiveRate(w.ProjectId, w.InvoiceLineId);
                if (rate is decimal r) {
                    var rowPay = w.Hours * r;
                    paycheck += rowPay;
                    if (w.InvoiceLineId is Guid) billed += rowPay;
                    if (w.ProjectId is Guid pidKey) {
                        var existing = perProjectAccum.GetValueOrDefault(pidKey);
                        perProjectAccum[pidKey] = (
                            existing.hours + w.Hours,
                            existing.billable + (w.IsBillable ? w.Hours : 0m),
                            (existing.paycheck ?? 0m) + rowPay,
                            billRate is not null ? (existing.revenue ?? 0m) + rowRevenue : existing.revenue,
                            existing.rateSampleHours + (billRate is not null ? w.Hours : 0m),
                            existing.rateSampleRevenue + rowRevenue);
                    }
                } else {
                    hoursUnrated += w.Hours;
                    if (w.ProjectId is Guid pidKey) {
                        var existing = perProjectAccum.GetValueOrDefault(pidKey);
                        perProjectAccum[pidKey] = (
                            existing.hours + w.Hours,
                            existing.billable + (w.IsBillable ? w.Hours : 0m),
                            existing.paycheck,
                            billRate is not null ? (existing.revenue ?? 0m) + rowRevenue : existing.revenue,
                            existing.rateSampleHours + (billRate is not null ? w.Hours : 0m),
                            existing.rateSampleRevenue + rowRevenue);
                    }
                }
            } else {
                // Daily / monthly: still accumulate hours + revenue per
                // project so the per-project breakdown shows hours and
                // bill-side totals, but leave per-project paycheck NULL.
                if (w.ProjectId is Guid pidKey) {
                    var existing = perProjectAccum.GetValueOrDefault(pidKey);
                    perProjectAccum[pidKey] = (
                        existing.hours + w.Hours,
                        existing.billable + (w.IsBillable ? w.Hours : 0m),
                        existing.paycheck,
                        billRate is not null ? (existing.revenue ?? 0m) + rowRevenue : existing.revenue,
                        existing.rateSampleHours + (billRate is not null ? w.Hours : 0m),
                        existing.rateSampleRevenue + rowRevenue);
                }
            }
        }

        // Expected hours over the window via the org's schedule + holiday
        // policy. Project-scoped policy would require picking a single
        // project (the calendar is cross-project here) so we deliberately
        // use the org-level resolver.
        var expectedHours = await ResolveExpectedHoursAsync(db, orgId, fromDate, toDate, ct);
        var deficit = expectedHours - hoursLogged;

        // Resolve the org-level paycheck per cadence. paycheckNullable is
        // a true nullable so we can distinguish "0.00 paycheck" (daily
        // cadence on a window with no logs) from "indeterminate" (monthly
        // cadence with expectedHours==0 — div/0 guard).
        decimal? paycheckNullable;
        if (isHourly) {
            // The accumulator already summed the cascade rate per row.
            paycheckNullable = paycheck;
        } else if (cadence == "daily") {
            if (membership.DailyRate is decimal dr) {
                // Workdays the member actually logged hours on — one log
                // of any size on a date counts as one paid day. Project
                // attribution intentionally lost: the rate is org-level.
                var distinctDays = monthLogs
                    .Where(w => w.Hours > 0m)
                    .Select(w => w.WorkDate)
                    .Distinct()
                    .Count();
                paycheckNullable = distinctDays * dr;
            } else {
                paycheckNullable = null;
            }
        } else { // monthly
            if (membership.MonthlyRate is decimal mr && expectedHours > 0m) {
                // Pro-rate: full month's pay × (logged / expected). We
                // CAP at the full monthly rate — anyone logging >expected
                // shouldn't earn beyond the contract. (If we ever support
                // overtime as a separate slot, do it explicitly.)
                var ratio = hoursLogged / expectedHours;
                if (ratio > 1m) ratio = 1m;
                paycheckNullable = mr * ratio;
            } else {
                // expectedHours==0 (fully-holiday window) or no monthly
                // rate set — leave indeterminate. The frontend renders
                // an em-dash + a warning hint.
                paycheckNullable = null;
            }
        }

        // Cadence-aware revenue, mirroring the invoice generator
        // (GatherCandidateLinesAsync). The user's mental model is that
        // cadence is the single source of truth for both cost and bill —
        // a monthly contract bills monthly, period. Revenue stays
        // hourly-by-rate only when cadence is hourly.
        decimal? revenueNullable;
        if (isHourly) {
            revenueNullable = revenue;
        } else if (cadence == "daily") {
            if (membership.DailyRate is decimal dr) {
                var distinctBillableDays = monthLogs
                    .Where(w => w.IsBillable && w.Hours > 0m)
                    .Select(w => w.WorkDate)
                    .Distinct()
                    .Count();
                revenueNullable = distinctBillableDays * dr;
            } else {
                revenueNullable = null;
            }
        } else { // monthly
            if (membership.MonthlyRate is decimal mr && expectedHours > 0m) {
                var ratio = billableHours / expectedHours;
                if (ratio > 1m) ratio = 1m;
                if (ratio < 0m) ratio = 0m;
                revenueNullable = mr * ratio;
            } else {
                revenueNullable = null;
            }
        }

        var workSummary = new WorkSummaryBlock(
            HoursLogged: hoursLogged,
            HoursExpected: expectedHours,
            Deficit: deficit,
            BillableHours: billableHours,
            // HoursUnrated is only a useful signal under hourly cadence —
            // the daily/monthly accumulators don't read per-worklog rates,
            // so reporting "X unrated hours" would always be 0 and confuse
            // the UI banner. Suppress it explicitly for non-hourly modes.
            HoursUnrated: isHourly ? hoursUnrated : 0m,
            // Same suppression for the bill-side counterpart — under
            // daily/monthly the per-worklog bill-rate cascade is not
            // consulted, so "billable hours without a rate" is a
            // category that doesn't apply.
            BillableHoursUnrated: isHourly ? billableHoursUnrated : 0m,
            // Monetary fields stripped below billing-read. Paycheck/Billed
            // (cost side) and Revenue (bill side) MUST stay driven by the
            // same canSeeBilling flag — viewerBucket is computed once
            // above; flipping one without the other would split the cache
            // bucket out of sync with what the response actually contains.
            //
            // Billed only makes sense under hourly cadence — it's the
            // already-invoiced subset of paycheck, computed from frozen
            // invoice_line.bill_rate snapshots. Daily/monthly cadences
            // don't generate per-row paycheck contributions, so billed
            // stays 0 (no rows have been "paid through invoicing").
            Paycheck: canSeeBilling ? paycheckNullable : null,
            Billed: canSeeBilling ? (isHourly ? billed : 0m) : null,
            Revenue: canSeeBilling ? revenueNullable : null);

        var perProject = perProjectAccum
            .Select(kv => new PerProjectRow(
                ProjectId: kv.Key,
                ProjectName: projectMeta.TryGetValue(kv.Key, out var meta) ? meta.Name : "(deleted)",
                Hours: kv.Value.hours,
                BillableHours: kv.Value.billable,
                // Per-project paycheck AND revenue attribution only under
                // hourly cadence. For daily/monthly the rate is org-wide;
                // the invoice generator emits one rollup line per member
                // (daily: per project; monthly: cross-project) and the
                // billing card mirrors that grain by collapsing the
                // per-project breakdown.
                Paycheck: canSeeBilling && isHourly ? kv.Value.paycheck : null,
                Revenue: canSeeBilling && isHourly ? kv.Value.revenue : null,
                // Weighted-avg effective rate per project. Divides total
                // revenue by total billable hours that had a rate — so
                // when some worklogs are frozen (invoice_lines.bill_rate)
                // and others are live (cascade), the displayed rate is
                // the correct blend and `rate × billableHours = revenue`
                // by construction. Suppressed for non-hourly cadences
                // (no per-worklog rate to average).
                EffectiveBillRate: canSeeBilling && isHourly && kv.Value.rateSampleHours > 0m
                    ? kv.Value.rateSampleRevenue / kv.Value.rateSampleHours
                    : (decimal?)null))
            .OrderByDescending(r => r.Hours)
            .ToList();

        var recentWorklogs = monthLogs
            .OrderByDescending(w => w.WorkDate).ThenByDescending(w => w.CreatedAt)
            .Take(20)
            .Select(w => new RecentWorklogRow(
                Id: w.Id,
                ProjectId: w.ProjectId,
                TaskId: w.TaskId,
                WorkDate: w.WorkDate,
                Hours: w.Hours,
                Notes: w.Notes,
                IsBillable: w.IsBillable,
                BillingStatus: w.InvoiceLineId != null
                    ? "billed"
                    : (w.IsBillable ? "billable" : "non_billable"),
                CreatedAt: w.CreatedAt))
            .ToList();

        return new MemberSummaryPayload(
            profile, projectMemberships,
            workSummary, perProject, recentWorklogs,
            fromDate, toDate);
    }

    // Sums ScheduleResolver.ResolveExpectedHours over the window using
    // the org's schedule + holiday config. Reads are cached under the
    // existing policy tag so a policy mutation invalidates this number
    // transitively (the outer cache entry also tags policy, so we don't
    // double-fetch within a TTL window).
    private static async Task<decimal> ResolveExpectedHoursAsync(
        TimeFlowDbContext db, Guid orgId,
        DateOnly from, DateOnly to,
        CancellationToken ct) {
        var policy = await db.Organisations.AsNoTracking()
            .Where(o => o.Id == orgId)
            .Select(o => new { o.ScheduleConfigJson, o.HolidayProfileJson })
            .FirstOrDefaultAsync(ct);

        OrgScheduleConfig schedule = SchedulePresets.Default;
        OrgHolidayProfile holidays = new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey };

        if (policy is not null) {
            if (!string.IsNullOrWhiteSpace(policy.ScheduleConfigJson)) {
                try {
                    schedule = System.Text.Json.JsonSerializer.Deserialize<OrgScheduleConfig>(
                        policy.ScheduleConfigJson,
                        new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))
                        ?? SchedulePresets.Default;
                } catch {
                    // PATCH validates the JSON — if it's malformed we'd
                    // rather report the default than 500 the entire page.
                    schedule = SchedulePresets.Default;
                }
            }
            if (!string.IsNullOrWhiteSpace(policy.HolidayProfileJson)) {
                try {
                    holidays = System.Text.Json.JsonSerializer.Deserialize<OrgHolidayProfile>(
                        policy.HolidayProfileJson,
                        new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))
                        ?? new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey };
                } catch {
                    holidays = new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey };
                }
            }
        }

        return ScheduleResolver.SumExpectedHours(from, to, schedule, holidays);
    }
}
