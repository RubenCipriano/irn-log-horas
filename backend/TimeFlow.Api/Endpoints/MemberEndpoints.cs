using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/members/* — list, invite-by-email (existing users only
// for Phase 5; token-link invites land with email infra later), change
// role, remove.
//
// Role-change rules baked into PATCH /memberships/{userId}:
//   1. Self-edits rejected — go to /transfer for owner handoff
//   2. Granting OR removing the Owner role requires the caller to BE
//      an Owner (the matrix says Admin can `members.assign_roles`, but
//      Owner-touching needs Owner)
//   3. Demoting the last Owner is rejected (assertNotLastOwner)
public static class MemberEndpoints {
    public static void MapMemberEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/members").RequireAuthorization();

        grp.MapGet("", List).RequireOrgPermission(Permission.MembersRead);
        grp.MapPost("", Add).RequireOrgPermission(Permission.MembersInvite);
        grp.MapPatch("/{userId:guid}", ChangeRole).RequireOrgPermission(Permission.MembersAssignRoles);
        grp.MapPatch("/{userId:guid}/compensation", UpdateCompensation).RequireOrgPermission(Permission.MembersUpdateCost);
        grp.MapDelete("/{userId:guid}", Remove).RequireOrgPermission(Permission.MembersRemove);

        // Hours summary + allocations are MembersRead-gated; the handlers
        // tighten by comparing target user vs caller (own vs org-wide).
        grp.MapGet("/{userId:guid}/hours-summary", HoursSummary).RequireOrgPermission(Permission.MembersRead);
        grp.MapGet("/{userId:guid}/allocations", Allocations).RequireOrgPermission(Permission.MembersRead);
    }

    public sealed record MemberItem(
        Guid UserId, string Email, string Name, string Role, DateTime JoinedAt,
        decimal? CostPerHour);

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/members
    // ---------------------------------------------------------------------
    public static async Task<IResult> List(
        Guid id,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        // Cost is HR-adjacent — never project it for viewers below Manager.
        // Belt-and-braces: server-side strip rather than relying on the UI
        // to hide the column.
        var canSeeCost = role.AtLeast(OrgRole.Manager);
        // The cost visibility changes the response shape, so the key must
        // encode whether cost is projected. Two buckets: "full" (Manager+)
        // and "redacted" (below Manager). This prevents a Manager's cached
        // response (with cost rates) from being served to a Viewer.
        var costBucket = canSeeCost ? "full" : "redacted";
        var members = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:members:list:{costBucket}",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { MembershipCacheTags.OrgMembers(orgId) },
            loader: async ct2 => await db.OrgMemberships
                .Where(m => m.OrgId == orgId)
                .OrderBy(m => m.CreatedAt)
                .Select(m => new MemberItem(
                    m.UserId, m.User!.Email, m.User.Name, m.Role, m.CreatedAt,
                    canSeeCost ? m.CostPerHour : null))
                .ToListAsync(ct2),
            ct: ct);
        return Results.Ok(members);
    }

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/members — add existing user by email + role
    // ---------------------------------------------------------------------
    public sealed record AddMemberRequest(
        [Required, EmailAddress] string Email,
        [Required] string Role);

    public static async Task<IResult> Add(
        Guid id,
        AddMemberRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var (orgId, callerRole) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var role = OrgRoleExtensions.FromWire(body.Role);
        if (role is null) return Results.Json(new { error = "Unknown role." }, statusCode: 400);

        // Owner grant requires Owner — even Admins can't mint owners.
        if (role == OrgRole.Owner && callerRole != OrgRole.Owner) {
            return Results.Json(new { error = "Only Owners can grant the Owner role." }, statusCode: 403);
        }

        // Hierarchy: a Manager can invite as TechLead/Developer/Viewer but
        // not as Manager/Admin/Owner. Owner exempt because it's already
        // gated above. We compare to `role` (the role being granted) since
        // there's no prior row to consider on Add.
        if (role != OrgRole.Owner && !OrgRoleHierarchy.Outranks(callerRole, role.Value)) {
            return Results.Json(new { error = "You can only invite members to a role below your own." }, statusCode: 403);
        }

        var email = body.Email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
        if (user is null) {
            // Phase 5 doesn't do email-token invites yet — the SPA should
            // surface this as "ask them to sign up first." We don't leak
            // user existence to outsiders; this endpoint is already gated.
            return Results.Json(new { error = "No TimeFlow account for that email." }, statusCode: 404);
        }

        var exists = await db.OrgMemberships.AnyAsync(m => m.OrgId == orgId && m.UserId == user.Id, ct);
        if (exists) return Results.Conflict(new { error = "Already a member." });

        db.OrgMemberships.Add(new OrgMembership {
            OrgId = orgId,
            UserId = user.Id,
            Role = role.Value.ToWire(),
        });
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] {
            MembershipCacheTags.OrgMembers(orgId),
            MembershipCacheTags.UserOrgs(user.Id),
        }, ct);
        await audit.RecordAsync("member.added", orgId, callerId, "membership", user.Id.ToString(),
            new { role = role.Value.ToWire() }, ct);

        return Results.Ok(new MemberItem(user.Id, user.Email, user.Name, role.Value.ToWire(), DateTime.UtcNow, CostPerHour: null));
    }

    // ---------------------------------------------------------------------
    // PATCH /api/orgs/{id}/members/{userId} — change role and/or cost rate
    //
    // The endpoint accepts EITHER field independently (or both). Role is
    // optional so a manager can adjust cost without re-asserting role.
    // Cost change requires the dedicated MembersUpdateCost permission;
    // ClearCost (when true) sets the column to null — distinguished from
    // "omit the field entirely, leave unchanged".
    // ---------------------------------------------------------------------
    public sealed record ChangeRoleRequest(
        string? Role,
        decimal? CostPerHour,
        bool? ClearCost);

    public static async Task<IResult> ChangeRole(
        Guid id,
        Guid userId,
        ChangeRoleRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var (orgId, callerRole) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var membership = await db.OrgMemberships
            .FirstOrDefaultAsync(m => m.OrgId == orgId && m.UserId == userId, ct);
        if (membership is null) return Results.NotFound();

        // Cost-only requests are allowed against your own row; only ROLE
        // edits trigger the legacy self-edit conflict.
        var wantsRoleChange = !string.IsNullOrWhiteSpace(body.Role);
        var wantsCostChange = body.CostPerHour is not null || body.ClearCost == true;
        if (!wantsRoleChange && !wantsCostChange) {
            return Results.Json(new { error = "Provide a role and/or cost change." }, statusCode: 400);
        }

        if (wantsRoleChange) {
            if (callerId == userId) {
                return Results.Conflict(new { error = "Self-role-edit blocked. Use /transfer for Owner handoff." });
            }

            var newRole = OrgRoleExtensions.FromWire(body.Role!);
            if (newRole is null) return Results.Json(new { error = "Unknown role." }, statusCode: 400);

            var oldRole = OrgRoleExtensions.FromWire(membership.Role) ?? OrgRole.Viewer;
            if (oldRole != newRole.Value) {
                // Owner role touches (grant or remove) require Owner caller.
                if ((oldRole == OrgRole.Owner || newRole.Value == OrgRole.Owner) && callerRole != OrgRole.Owner) {
                    return Results.Json(new { error = "Only Owners can grant or remove the Owner role." }, statusCode: 403);
                }

                // Hierarchy: BOTH the target's current role AND the incoming role
                // must be strictly below the caller's rank — except in the Owner
                // case above (an Owner editing an Owner row is allowed). A Manager
                // can't demote an Admin, can't promote to Admin, can't touch an
                // Admin at all.
                if (oldRole != OrgRole.Owner && newRole.Value != OrgRole.Owner) {
                    if (!OrgRoleHierarchy.Outranks(callerRole, oldRole)) {
                        return Results.Json(new { error = "You can't change the role of someone at or above your rank." }, statusCode: 403);
                    }
                    if (!OrgRoleHierarchy.Outranks(callerRole, newRole.Value)) {
                        return Results.Json(new { error = "You can only assign roles below your own." }, statusCode: 403);
                    }
                }

                // Demoting an Owner can't leave the org without one.
                if (oldRole == OrgRole.Owner && newRole.Value != OrgRole.Owner) {
                    try { await OrgRoleGuard.AssertNotLastOwnerAsync(db, orgId, userId, ct); }
                    catch (ConflictException ex) { return Results.Conflict(new { error = ex.Message, code = ex.Code }); }
                }

                membership.Role = newRole.Value.ToWire();
                await audit.RecordAsync("member.role_changed", orgId, callerId, "membership", userId.ToString(),
                    new { from = oldRole.ToWire(), to = newRole.Value.ToWire() }, ct);
            }
        }

        if (wantsCostChange) {
            // Dedicated permission check — Manager+ (matches matrix) but
            // gated independently of MembersAssignRoles so a future
            // tightening to Owner-only is one matrix entry away.
            if (!PermissionMatrix.Can(callerRole, Permission.MembersUpdateCost)) {
                return Results.Json(new { error = "You can't change cost rates." }, statusCode: 403);
            }
            var oldCost = membership.CostPerHour;
            var newCost = body.ClearCost == true ? (decimal?)null : body.CostPerHour;
            if (newCost is decimal v && (v < 0m || v > 999_999.99m)) {
                return Results.Json(new { error = "Cost must be between 0 and 999999.99." }, statusCode: 400);
            }
            if (oldCost != newCost) {
                membership.CostPerHour = newCost;
                await audit.RecordAsync("member.cost_changed", orgId, callerId, "membership", userId.ToString(),
                    new { from = oldCost, to = newCost }, ct);
            }
        }

        membership.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] {
            MembershipCacheTags.OrgMembers(orgId),
            MembershipCacheTags.UserOrgs(userId),
        }, ct);

        return Results.Ok(new { ok = true, role = membership.Role, costPerHour = membership.CostPerHour });
    }

    // ---------------------------------------------------------------------
    // PATCH /api/orgs/{id}/members/{userId}/compensation
    //
    // Single source of truth for member compensation. Atomically writes
    // pay_cadence + the three rate slots (cost_per_hour / daily_rate /
    // monthly_rate). Tri-state semantics — each numeric field is independently
    // nullable; OMITTING a field on the request leaves the column unchanged,
    // sending `null` clears it explicitly. Sending all three on every save
    // lets the editor "remember" prior values across cadence toggles.
    //
    // Server validation:
    //   * cadence ∈ {"hourly","daily","monthly"} (NULL is rejected here —
    //     NULL on disk is the legacy "implicit hourly" sentinel; explicit
    //     writes always pin a real value).
    //   * The rate matching the chosen cadence MUST be non-null and in
    //     [0, 999999.99]. Other rates may be persisted (or omitted).
    //
    // Why this is split from PATCH /members/{userId}: that endpoint mixes
    // role + cost; the legacy cost branch only writes cost_per_hour and
    // silently clobbers the cadence-aware tuple. Cleanest fix: a single
    // dedicated endpoint that writes the full compensation block in one
    // shot, with the legacy branch staying alive for one release window
    // for backwards-compat with old clients.
    // ---------------------------------------------------------------------
    public sealed record CompensationResponse(
        Guid UserId, Guid OrgId,
        string Cadence,
        decimal? HourlyRate,
        decimal? DailyRate,
        decimal? MonthlyRate,
        DateTime UpdatedAt);

    public static async Task<IResult> UpdateCompensation(
        Guid id,
        Guid userId,
        HttpRequest request,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        // Manual JSON parse — System.Text.Json + records can't distinguish
        // "field omitted" from "field present and null", which the tri-state
        // contract relies on. Walk the document so unset = unchanged and
        // explicit null = clear.
        using var doc = await System.Text.Json.JsonDocument.ParseAsync(request.Body, cancellationToken: ct);
        var root = doc.RootElement;
        if (root.ValueKind != System.Text.Json.JsonValueKind.Object) {
            return Results.Json(new { error = "Body must be a JSON object." }, statusCode: 400);
        }

        string? cadence = null;
        bool hourlySet = false, dailySet = false, monthlySet = false;
        decimal? hourlyRate = null, dailyRate = null, monthlyRate = null;

        foreach (var prop in root.EnumerateObject()) {
            switch (prop.Name) {
                case "cadence":
                    cadence = prop.Value.ValueKind == System.Text.Json.JsonValueKind.Null
                        ? null
                        : prop.Value.GetString();
                    break;
                case "hourlyRate":
                    hourlySet = true;
                    hourlyRate = prop.Value.ValueKind == System.Text.Json.JsonValueKind.Null
                        ? null : prop.Value.GetDecimal();
                    break;
                case "dailyRate":
                    dailySet = true;
                    dailyRate = prop.Value.ValueKind == System.Text.Json.JsonValueKind.Null
                        ? null : prop.Value.GetDecimal();
                    break;
                case "monthlyRate":
                    monthlySet = true;
                    monthlyRate = prop.Value.ValueKind == System.Text.Json.JsonValueKind.Null
                        ? null : prop.Value.GetDecimal();
                    break;
            }
        }

        if (string.IsNullOrWhiteSpace(cadence)) {
            return Results.Json(new { error = "Cadence is required.", code = "compensation.cadence_required" }, statusCode: 400);
        }
        var normalized = cadence.Trim().ToLowerInvariant();
        if (normalized is not ("hourly" or "daily" or "monthly")) {
            return Results.Json(new { error = "Cadence must be one of hourly|daily|monthly.", code = "compensation.cadence_invalid" }, statusCode: 400);
        }

        // Range check is shared across all three rate slots — anything in
        // [0, 999999.99] is acceptable; precision is enforced by the column
        // type (numeric(10,2)).
        static bool InRange(decimal? v) => v is null || (v.Value >= 0m && v.Value <= 999_999.99m);
        if (!InRange(hourlyRate) || !InRange(dailyRate) || !InRange(monthlyRate)) {
            return Results.Json(new { error = "Rate must be between 0 and 999999.99." }, statusCode: 400);
        }

        var membership = await db.OrgMemberships
            .FirstOrDefaultAsync(m => m.OrgId == orgId && m.UserId == userId, ct);
        if (membership is null) return Results.NotFound();

        // Compose the post-write rate values: "set" fields take the new
        // value (which can be null), "unset" fields stay as-is.
        var newHourly = hourlySet ? hourlyRate : membership.CostPerHour;
        var newDaily = dailySet ? dailyRate : membership.DailyRate;
        var newMonthly = monthlySet ? monthlyRate : membership.MonthlyRate;

        // Cadence-aware rate-required check: whichever cadence is chosen,
        // the corresponding rate post-write MUST be non-null. We check the
        // POST-write tuple so a "set cadence + set the matching rate" call
        // succeeds even if the matching rate was previously null.
        decimal? requiredRate = normalized switch {
            "hourly" => newHourly,
            "daily" => newDaily,
            "monthly" => newMonthly,
            _ => null,
        };
        if (requiredRate is null) {
            return Results.Json(new {
                error = "The rate matching the selected cadence must be set.",
                code = "compensation.rate_required_for_cadence",
            }, statusCode: 400);
        }

        var beforeCadence = membership.PayCadence;
        var beforeHourly = membership.CostPerHour;
        var beforeDaily = membership.DailyRate;
        var beforeMonthly = membership.MonthlyRate;

        var changed = beforeCadence != normalized
            || beforeHourly != newHourly
            || beforeDaily != newDaily
            || beforeMonthly != newMonthly;

        if (changed) {
            membership.PayCadence = normalized;
            membership.CostPerHour = newHourly;
            membership.DailyRate = newDaily;
            membership.MonthlyRate = newMonthly;
            membership.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);

            // Tag drops:
            //   * org members tag — the cached member-detail + member-list
            //     payloads project the cadence + rate columns.
            //   * org worklogs tag — paycheck math reads these rates per
            //     row; without it, cached /summary payloads stay stale.
            //   * org policy tag — monthly cadence pro-rates by expected
            //     hours from the schedule policy; flipping cadence to
            //     'monthly' or back changes which math the cached summary
            //     ran, so drop the policy-tied bucket too.
            //   * per-user orgs tag — the membership reader caches
            //     (userId, orgId) -> role; rates piggyback on the same
            //     freshness gate.
            await cache.InvalidateTagsAsync(new[] {
                MembershipCacheTags.OrgMembers(orgId),
                $"org:{orgId:N}:worklogs",
                MembershipCacheTags.OrgPolicy(orgId),
                MembershipCacheTags.UserOrgs(userId),
            }, ct);

            await audit.RecordAsync(
                "member.compensation_updated",
                orgId, callerId, "membership", userId.ToString(),
                new {
                    from = new {
                        cadence = beforeCadence,
                        hourlyRate = beforeHourly,
                        dailyRate = beforeDaily,
                        monthlyRate = beforeMonthly,
                    },
                    to = new {
                        cadence = normalized,
                        hourlyRate = newHourly,
                        dailyRate = newDaily,
                        monthlyRate = newMonthly,
                    },
                }, ct);
        }

        return Results.Ok(new CompensationResponse(
            UserId: userId,
            OrgId: orgId,
            Cadence: normalized,
            HourlyRate: newHourly,
            DailyRate: newDaily,
            MonthlyRate: newMonthly,
            UpdatedAt: membership.UpdatedAt));
    }

    // ---------------------------------------------------------------------
    // DELETE /api/orgs/{id}/members/{userId}
    // ---------------------------------------------------------------------
    public static async Task<IResult> Remove(
        Guid id,
        Guid userId,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, callerRole) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        if (callerId == userId) {
            return Results.Conflict(new { error = "Cannot remove yourself. Transfer ownership first if needed." });
        }

        var membership = await db.OrgMemberships
            .FirstOrDefaultAsync(m => m.OrgId == orgId && m.UserId == userId, ct);
        if (membership is null) return Results.NotFound();

        var role = OrgRoleExtensions.FromWire(membership.Role) ?? OrgRole.Viewer;
        if (role == OrgRole.Owner) {
            if (callerRole != OrgRole.Owner) {
                return Results.Json(new { error = "Only Owners can remove an Owner." }, statusCode: 403);
            }
            try { await OrgRoleGuard.AssertNotLastOwnerAsync(db, orgId, userId, ct); }
            catch (ConflictException ex) { return Results.Conflict(new { error = ex.Message, code = ex.Code }); }
        } else {
            // Hierarchy: non-Owner targets are removable only by someone
            // strictly above their rank. A Manager can remove a Developer,
            // never another Manager nor an Admin.
            if (!OrgRoleHierarchy.Outranks(callerRole, role)) {
                return Results.Json(new { error = "You can't remove someone at or above your rank." }, statusCode: 403);
            }
        }

        db.OrgMemberships.Remove(membership);
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] {
            MembershipCacheTags.OrgMembers(orgId),
            MembershipCacheTags.UserOrgs(userId),
        }, ct);
        await audit.RecordAsync("member.removed", orgId, callerId, "membership", userId.ToString(),
            new { role = role.ToWire() }, ct);

        return Results.Ok(new { ok = true });
    }

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/members/{userId}/hours-summary?from&to
    //
    // Totals + per-project breakdown of one member's worklogs in a window.
    // Per-row cost is computed at request time (no history): override rate
    // from `project_members.cost_per_hour` falls back to the org-level
    // `org_memberships.cost_per_hour`.
    //
    // Cost data is stripped server-side when the caller is below Manager
    // rank — hours stay visible so a developer can see their own totals
    // but not their rate.
    // ---------------------------------------------------------------------
    public sealed record HoursSummaryProjectRow(
        string Kind,                          // "native" | "upstream"
        Guid? ProjectId,
        Guid? ConnectionId,
        string? UpstreamProjectId,
        string ProjectName,
        decimal Hours,
        decimal? CostPerHour,
        decimal? Cost);

    // Internal cache payload for HoursSummary — groups the org-level rate
    // and the computed per-project rows into a single cacheable unit.
    private sealed record HoursSummaryPayload(
        decimal? OrgRate,
        List<HoursSummaryProjectRow> Rows);

    public static async Task<IResult> HoursSummary(
        Guid id, Guid userId,
        DateOnly? from, DateOnly? to,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, callerRole) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        // Self-view vs others-view: hitting your OWN row only needs
        // worklogs.read_own; anyone else needs worklogs.read_org.
        var isSelf = callerId == userId;
        var requiredPerm = isSelf ? Permission.WorklogsReadOwn : Permission.WorklogsReadOrg;
        if (!PermissionMatrix.Can(callerRole, requiredPerm)) {
            return Results.Json(new { error = "Forbidden." }, statusCode: 403);
        }

        // Resolve dates BEFORE building the cache key so the key is always
        // concrete — a missing `from`/`to` must not produce an under-specified
        // key that would conflate different windows.
        var fromDate = from ?? new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        var toDate = to ?? fromDate.AddMonths(1).AddDays(-1);
        if (toDate < fromDate) return Results.Json(new { error = "to < from." }, statusCode: 400);
        if ((toDate.DayNumber - fromDate.DayNumber) > 366) {
            return Results.Json(new { error = "Range too wide (max 1 year)." }, statusCode: 400);
        }

        var canSeeCost = callerRole.AtLeast(OrgRole.Manager);
        // Encode cost visibility in the key — a Manager's response (with rates)
        // must not be served to a Viewer whose cached response has null costs.
        var costBucket = canSeeCost ? "full" : "redacted";

        var payload = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:member-hours:{userId:N}:{fromDate:yyyyMMdd}:{toDate:yyyyMMdd}:{costBucket}",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] {
                $"org:{orgId:N}:worklogs",
                $"org:{orgId:N}:members",
            },
            loader: async ct2 => {
                // Resolve membership rate ONCE; we cascade per-project overrides
                // on top of it.
                var membership = await db.OrgMemberships.AsNoTracking()
                    .FirstOrDefaultAsync(m => m.OrgId == orgId && m.UserId == userId, ct2);
                if (membership is null) return null!;
                var orgRate = membership.CostPerHour;

                // Per-project rate override for THIS user. Same column is also
                // the BILL rate per spec — invoice generation reads it as the
                // first stop in the rate cascade (`pm.cost_per_hour ?? p.bill_rate
                // ?? client.default_bill_rate`). In v1's consulting model cost =
                // bill, so the same number drives both this cost report and the
                // customer's invoice.
                var overrides = await db.ProjectMembers.AsNoTracking()
                    .Where(pm => pm.OrgId == orgId && pm.UserId == userId && pm.CostPerHour != null)
                    .ToDictionaryAsync(pm => pm.ProjectId, pm => pm.CostPerHour!.Value, ct2);

                // Phase C — one source. Every worklog now points at a `native_projects`
                // row (the sync job sets `worklog.ProjectId` to the mirror project
                // for upstream-task worklogs, and locally-logged hours carry the
                // local project directly). The mirror tuple on the project row
                // tells us whether to label the entry "native" or "upstream".
                var groups = await db.Worklogs.AsNoTracking()
                    .Where(w => w.OrgId == orgId && w.UserId == userId
                        && w.WorkDate >= fromDate && w.WorkDate <= toDate
                        && w.ProjectId != null)
                    .GroupBy(w => w.ProjectId!.Value)
                    .Select(g => new { ProjectId = g.Key, Hours = g.Sum(x => x.Hours) })
                    .ToListAsync(ct2);

                var projectIds = groups.Select(g => g.ProjectId).Distinct().ToList();
                var projectMeta = await db.NativeProjects.AsNoTracking()
                    .Where(p => projectIds.Contains(p.Id))
                    .Select(p => new { p.Id, p.Name, p.ParentProjectId, p.ConnectionId, p.UpstreamProjectId })
                    .ToDictionaryAsync(p => p.Id, ct2);

                // Build a parent-of map for the projects we touched so a
                // worklog on a sub-project can inherit an allocation set
                // higher in the tree (typical: rate on engagement, hours
                // on synced leaf). Mirrors the invoice-side cascade walk
                // (spec I1 nearest-ancestor-wins).
                var parentOf = projectMeta.Values
                    .ToDictionary(p => p.Id, p => p.ParentProjectId);
                // Also fetch any ancestors not in the worklog set so the
                // walk doesn't dead-end before reaching the engagement.
                var seen = new HashSet<Guid>(parentOf.Keys);
                var frontier = parentOf.Values.OfType<Guid>().Where(p => !seen.Contains(p)).ToList();
                while (frontier.Count > 0) {
                    var more = await db.NativeProjects.AsNoTracking()
                        .Where(p => frontier.Contains(p.Id))
                        .Select(p => new { p.Id, p.ParentProjectId })
                        .ToListAsync(ct2);
                    var next = new List<Guid>();
                    foreach (var a in more) {
                        parentOf[a.Id] = a.ParentProjectId;
                        seen.Add(a.Id);
                        if (a.ParentProjectId is Guid pid && !seen.Contains(pid)) next.Add(pid);
                    }
                    frontier = next;
                }

                decimal? WalkRate(Guid leafProjectId) {
                    var cursor = (Guid?)leafProjectId;
                    while (cursor is Guid pid) {
                        if (overrides.TryGetValue(pid, out var rate)) return rate;
                        cursor = parentOf.GetValueOrDefault(pid);
                    }
                    return null;
                }

                var rows = new List<HoursSummaryProjectRow>();
                foreach (var g in groups) {
                    var meta = projectMeta.GetValueOrDefault(g.ProjectId);
                    var isUpstream = meta?.ConnectionId is Guid && meta.UpstreamProjectId != null;
                    // Nearest-ancestor-wins per spec I1 — walk from the leaf
                    // up to the engagement; fall back to the org-level rate.
                    var rate = WalkRate(g.ProjectId) ?? orgRate;
                    var cost = canSeeCost && rate is decimal r ? g.Hours * r : (decimal?)null;
                    rows.Add(new HoursSummaryProjectRow(
                        Kind: isUpstream ? "upstream" : "native",
                        ProjectId: isUpstream ? null : g.ProjectId,
                        ConnectionId: isUpstream ? meta!.ConnectionId : null,
                        UpstreamProjectId: isUpstream ? meta!.UpstreamProjectId : null,
                        ProjectName: meta?.Name ?? "(deleted)",
                        Hours: g.Hours,
                        CostPerHour: canSeeCost ? rate : null,
                        Cost: cost));
                }

                return new HoursSummaryPayload(orgRate, rows);
            },
            ct: ct);

        // A null payload means the user is not a member of this org.
        if (payload is null) return Results.NotFound();

        var sorted = payload.Rows.OrderByDescending(r => r.Hours).ToList();
        var totalHours = sorted.Sum(r => r.Hours);
        var totalCost = canSeeCost ? sorted.Sum(r => r.Cost ?? 0m) : (decimal?)null;

        return Results.Ok(new {
            from = fromDate,
            to = toDate,
            totalHours,
            costPerHour = canSeeCost ? payload.OrgRate : null,
            totalCost,
            byProject = sorted,
        });
    }

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/members/{userId}/allocations
    //
    // Lists native projects this member is allocated to. Cost overrides
    // come along when the caller can see costs (Manager+).
    // ---------------------------------------------------------------------
    public sealed record MemberAllocationItem(
        Guid ProjectId, string ProjectName,
        decimal? CostPerHour, DateTime AllocatedAt);

    public static async Task<IResult> Allocations(
        Guid id, Guid userId,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, callerRole) = http.RequireOrgContext();
        var canSeeCost = callerRole.AtLeast(OrgRole.Manager);
        // Encode cost visibility — a Manager's cached rows (with rates) must
        // not be returned to a Viewer who would receive null costs.
        var costBucket = canSeeCost ? "full" : "redacted";

        var rows = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:allocations:{userId:N}:{costBucket}",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] {
                $"org:{orgId:N}:members",
                $"org:{orgId:N}:projects",
            },
            loader: async ct2 => {
                // Order on the SQL side using the project's name directly —
                // ordering on the constructed DTO's field doesn't translate.
                var raw = await (
                    from pm in db.ProjectMembers.AsNoTracking()
                    join p in db.NativeProjects.AsNoTracking() on pm.ProjectId equals p.Id
                    where pm.OrgId == orgId && pm.UserId == userId
                    orderby p.Name
                    select new {
                        p.Id, p.Name,
                        pm.CostPerHour, pm.AllocatedAt,
                    }
                ).ToListAsync(ct2);
                return raw.Select(r => new MemberAllocationItem(
                    r.Id, r.Name,
                    canSeeCost ? r.CostPerHour : null,
                    r.AllocatedAt)).ToList();
            },
            ct: ct);

        return Results.Ok(rows);
    }
}
