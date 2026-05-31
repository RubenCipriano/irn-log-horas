using System.ComponentModel.DataAnnotations;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Billing;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Domain.Holidays;
using TimeFlow.Domain.Schedule;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/invoices/* — invoice CRUD + generation flow.
//
// Post-collapse model: the Project IS the engagement AND the invoiced
// party (Client was absorbed into NativeProject). The root project (no
// parent) is the "engagement / client" for cross-engagement disambiguation
// in member-target invoices.
//
// Cadence-aware emit (sourced from org_memberships.pay_cadence per worklog
// owner — NULL is the legacy 'hourly' sentinel):
//   * hourly   one line per worklog: Quantity = hours, Amount = hours * rate.
//              Rate cascade walks ancestors:
//                1. project_members.cost_per_hour (nearest-ancestor wins)
//                2. nearest-ancestor project.bill_rate
//                3. nearest-ancestor project.default_bill_rate
//                4. cost_per_hour again as "no-markup" fallback
//   * daily    one rollup line per (member, project): Quantity = distinct
//              workdays, Amount = days * daily_rate. Per-project bill_rate
//              override is bypassed.
//   * monthly  one rollup line per member (cross-project): Quantity = ratio
//              clamped to [0,1] = loggedHours / expectedHours, Amount =
//              monthly_rate * ratio. Per-project bill_rate override bypassed.
//
// State machine: draft → sent → paid OR * → void. Voiding clears the
// worklog → invoice_line pointer (and the invoice_line_worklogs sidecar)
// so hours can be re-invoiced.
public static class InvoiceEndpoints {
    public static void MapInvoiceEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/invoices").RequireAuthorization();

        grp.MapGet("", List).RequireOrgPermission(Permission.InvoicesRead);
        grp.MapPost("/preview", Preview).RequireOrgPermission(Permission.InvoicesWrite);
        grp.MapPost("/generate", Generate).RequireOrgPermission(Permission.InvoicesWrite);
        grp.MapPost("/preview-for-member", PreviewForMember).RequireOrgPermission(Permission.InvoicesWrite);
        grp.MapPost("/from-member", GenerateFromMember).RequireOrgPermission(Permission.InvoicesWrite);
        grp.MapGet("/{invoiceId:guid}", Get).RequireOrgPermission(Permission.InvoicesRead);
        grp.MapPatch("/{invoiceId:guid}", Update).RequireOrgPermission(Permission.InvoicesWrite);
        grp.MapDelete("/{invoiceId:guid}", Delete).RequireOrgPermission(Permission.InvoicesWrite);
        grp.MapGet("/{invoiceId:guid}/pdf", DownloadPdf).RequireOrgPermission(Permission.InvoicesRead);
    }

    public sealed record InvoiceItem(
        Guid Id, string Number, Guid ProjectId, string ProjectName,
        DateOnly PeriodFrom, DateOnly PeriodTo, string Status,
        decimal Subtotal, decimal TaxPct, decimal TaxAmount, decimal Total,
        string Currency,
        DateTime? IssuedAt, DateOnly? DueAt, DateTime? PaidAt,
        DateTime CreatedAt);

    public sealed record InvoiceLineItem(
        Guid Id, Guid? WorklogId, string Description,
        decimal Hours, decimal BillRate, decimal Amount, int Ordinal,
        decimal Quantity, string QuantityUnit, string Cadence);

    public sealed record InvoiceDetail(
        Guid Id, string Number, Guid ProjectId, string ProjectName,
        DateOnly PeriodFrom, DateOnly PeriodTo, string Status,
        decimal Subtotal, decimal TaxPct, decimal TaxAmount, decimal Total,
        string Currency, string? Notes,
        DateTime? IssuedAt, DateOnly? DueAt, DateTime? PaidAt,
        DateTime CreatedAt, DateTime UpdatedAt,
        IReadOnlyList<InvoiceLineItem> Lines);

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/invoices?status=&projectId=&skip=&take=
    // ---------------------------------------------------------------------
    public static async Task<IResult> List(
        Guid id, string? status, Guid? projectId, int? skip, int? take,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var q = db.Invoices.AsNoTracking().Where(i => i.OrgId == orgId);
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(i => i.Status == status);
        if (projectId is Guid pid) q = q.Where(i => i.ProjectId == pid);

        var total = await q.CountAsync(ct);
        var page = await q
            .OrderByDescending(i => i.CreatedAt)
            .Skip(Math.Max(0, skip ?? 0))
            .Take(Math.Clamp(take ?? 50, 1, 200))
            .Join(db.NativeProjects.AsNoTracking(),
                i => i.ProjectId, p => p.Id,
                (i, p) => new InvoiceItem(
                    i.Id, i.Number, i.ProjectId, i.BilledPartyName ?? p.Name,
                    i.PeriodFrom, i.PeriodTo, i.Status,
                    i.Subtotal, i.TaxPct, i.TaxAmount, i.Total,
                    i.Currency,
                    i.IssuedAt, i.DueAt, i.PaidAt,
                    i.CreatedAt))
            .ToListAsync(ct);
        return Results.Ok(new { total, items = page });
    }

    // ---------------------------------------------------------------------
    // POST /preview — project-target preview (returns candidate lines)
    // ---------------------------------------------------------------------
    public sealed record PreviewRequest(
        [Required] Guid ProjectId,
        [Required] DateOnly PeriodFrom,
        [Required] DateOnly PeriodTo,
        decimal? TaxPct,
        string? Notes);

    public static async Task<IResult> Preview(
        Guid id, PreviewRequest body,
        TimeFlowDbContext db,
        ProjectPolicyResolver policy,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) return Results.ValidationProblem(errors);
        var (orgId, _) = http.RequireOrgContext();
        if (body.PeriodTo < body.PeriodFrom) return Results.Json(new { error = "to < from." }, statusCode: 400);

        var candidates = await GatherCandidateLinesAsync(
            db, policy, orgId,
            projectFilterId: body.ProjectId, memberFilterId: null,
            body.PeriodFrom, body.PeriodTo, ct);
        if (candidates is null) return Results.NotFound();

        var taxPct = body.TaxPct ?? 0m;
        var (subtotal, taxAmount, total) = ComputeTotals(candidates.Lines, taxPct);

        return Results.Ok(new {
            projectId = body.ProjectId,
            billedPartyName = candidates.BilledPartyName,
            currency = candidates.Currency,
            periodFrom = body.PeriodFrom,
            periodTo = body.PeriodTo,
            taxPct,
            subtotal,
            taxAmount,
            total,
            lines = candidates.Lines,
            warnings = candidates.Warnings,
        });
    }

    // ---------------------------------------------------------------------
    // POST /generate — project-target persistence
    // ---------------------------------------------------------------------
    public static async Task<IResult> Generate(
        Guid id, PreviewRequest body,
        TimeFlowDbContext db,
        ProjectPolicyResolver policy,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) return Results.ValidationProblem(errors);
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        if (body.PeriodTo < body.PeriodFrom) return Results.Json(new { error = "to < from." }, statusCode: 400);

        var taxPct = body.TaxPct ?? 0m;
        if (taxPct < 0m || taxPct > 100m) return Results.Json(new { error = "TaxPct must be 0-100." }, statusCode: 400);

        var candidates = await GatherCandidateLinesAsync(
            db, policy, orgId,
            projectFilterId: body.ProjectId, memberFilterId: null,
            body.PeriodFrom, body.PeriodTo, ct);
        if (candidates is null) return Results.NotFound();
        if (candidates.Lines.Count == 0) {
            return Results.Json(new {
                error = "No billable worklogs in this period for this project.",
                warnings = candidates.Warnings,
            }, statusCode: 400);
        }

        var (subtotal, taxAmount, total) = ComputeTotals(candidates.Lines, taxPct);
        var invoice = await PersistInvoiceAsync(
            db, orgId, callerId,
            candidates,
            projectId: body.ProjectId,
            periodFrom: body.PeriodFrom, periodTo: body.PeriodTo,
            taxPct: taxPct, subtotal: subtotal, taxAmount: taxAmount, total: total,
            notes: body.Notes,
            ct: ct);
        if (invoice is null) return Results.Json(
            new { error = "Could not allocate an invoice number under contention." },
            statusCode: 409);

        await cache.InvalidateTagsAsync(new[] {
            $"org:{orgId:N}:invoices",
            $"org:{orgId:N}:worklogs",
        }, ct);
        await audit.RecordAsync("invoice.generated", orgId, callerId, "invoice", invoice.Id.ToString(),
            new {
                number = invoice.Number,
                projectId = body.ProjectId,
                lineCount = candidates.Lines.Count,
                total,
            }, ct);

        return Results.Ok(new { id = invoice.Id, number = invoice.Number, total });
    }

    // ---------------------------------------------------------------------
    // POST /preview-for-member — member-target preview
    // ---------------------------------------------------------------------
    public sealed record MemberPreviewRequest(
        [Required] Guid UserId,
        [Required] DateOnly PeriodFrom,
        [Required] DateOnly PeriodTo,
        Guid? ProjectId,
        Guid? ClientId,
        decimal? TaxPct,
        string? Notes);

    public static async Task<IResult> PreviewForMember(
        Guid id, MemberPreviewRequest body,
        TimeFlowDbContext db,
        ProjectPolicyResolver policy,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) return Results.ValidationProblem(errors);
        var (orgId, _) = http.RequireOrgContext();
        if (body.PeriodTo < body.PeriodFrom) return Results.Json(new { error = "to < from." }, statusCode: 400);

        // Membership must exist or we 404 — never leak whether userId
        // is a member of another org.
        var member = await (
            from m in db.OrgMemberships.AsNoTracking()
            join u in db.Users.AsNoTracking() on m.UserId equals u.Id
            where m.OrgId == orgId && m.UserId == body.UserId
            select new { m.UserId, u.Name, u.Email }
        ).FirstOrDefaultAsync(ct);
        if (member is null) return Results.NotFound();

        var candidates = await GatherCandidateLinesAsync(
            db, policy, orgId,
            projectFilterId: body.ProjectId, memberFilterId: body.UserId,
            body.PeriodFrom, body.PeriodTo, ct);
        if (candidates is null) return Results.NotFound();

        var taxPct = body.TaxPct ?? 0m;
        var (subtotal, taxAmount, total) = ComputeTotals(candidates.Lines, taxPct);

        // Decorate the engagement-id list with names so the UI's client-picker
        // shows "Accenture" instead of an 8-char id slice.
        var candidateClients = candidates.CandidateEngagementIds.Count == 0
            ? Array.Empty<object>()
            : await db.NativeProjects.AsNoTracking()
                .Where(p => p.OrgId == orgId && candidates.CandidateEngagementIds.Contains(p.Id))
                .Select(p => new { id = p.Id, name = p.Name })
                .ToArrayAsync(ct);

        return Results.Ok(new {
            memberId = body.UserId,
            memberName = string.IsNullOrWhiteSpace(member.Name) ? member.Email : member.Name,
            projectId = body.ProjectId,
            billedPartyName = candidates.BilledPartyName,
            currency = candidates.Currency,
            periodFrom = body.PeriodFrom,
            periodTo = body.PeriodTo,
            taxPct,
            subtotal,
            taxAmount,
            total,
            lines = candidates.Lines,
            warnings = candidates.Warnings,
            candidateClientIds = candidates.CandidateEngagementIds,
            candidateClients,
            multipleClients = candidates.CandidateEngagementIds.Count > 1,
        });
    }

    // ---------------------------------------------------------------------
    // POST /from-member — member-target persistence
    // ---------------------------------------------------------------------
    public static async Task<IResult> GenerateFromMember(
        Guid id, MemberPreviewRequest body,
        TimeFlowDbContext db,
        ProjectPolicyResolver policy,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) return Results.ValidationProblem(errors);
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        if (body.PeriodTo < body.PeriodFrom) return Results.Json(new { error = "to < from." }, statusCode: 400);

        var taxPct = body.TaxPct ?? 0m;
        if (taxPct < 0m || taxPct > 100m) return Results.Json(new { error = "TaxPct must be 0-100." }, statusCode: 400);

        var memberExists = await db.OrgMemberships.AsNoTracking()
            .AnyAsync(m => m.OrgId == orgId && m.UserId == body.UserId, ct);
        if (!memberExists) return Results.NotFound();

        var candidates = await GatherCandidateLinesAsync(
            db, policy, orgId,
            projectFilterId: body.ProjectId, memberFilterId: body.UserId,
            body.PeriodFrom, body.PeriodTo, ct);
        if (candidates is null) return Results.NotFound();

        if (candidates.Lines.Count == 0) {
            return Results.Json(new {
                error = "No billable worklogs in this period for this member.",
                warnings = candidates.Warnings,
            }, statusCode: 400);
        }

        // Engagement (= "client") disambiguation. When the member's hours
        // span multiple engagements and the caller hasn't picked one, kick
        // the picker back to the UI rather than silently choosing for them.
        Guid engagementId;
        if (body.ProjectId is Guid filteredPid) {
            engagementId = candidates.PrimaryEngagementId ?? filteredPid;
        } else if (body.ClientId is Guid pickedClient) {
            if (!candidates.CandidateEngagementIds.Contains(pickedClient)) {
                return Results.Json(new {
                    error = "MEMBER_CLIENT_NOT_IN_RANGE",
                    clientIds = candidates.CandidateEngagementIds,
                }, statusCode: 409);
            }
            engagementId = pickedClient;
        } else if (candidates.CandidateEngagementIds.Count > 1) {
            return Results.Json(new {
                error = "MEMBER_SPANS_CLIENTS",
                clientIds = candidates.CandidateEngagementIds,
            }, statusCode: 409);
        } else if (candidates.CandidateEngagementIds.Count == 1) {
            engagementId = candidates.CandidateEngagementIds[0];
        } else {
            return Results.Json(new {
                error = "MEMBER_NO_ENGAGEMENT",
            }, statusCode: 400);
        }

        // For the persisted invoice.project_id we prefer:
        //   - the explicit project filter if set
        //   - otherwise the engagement root (the "client") so list/group
        //     views surface the invoice under the right engagement.
        var persistedProjectId = body.ProjectId ?? engagementId;

        var (subtotal, taxAmount, total) = ComputeTotals(candidates.Lines, taxPct);
        var invoice = await PersistInvoiceAsync(
            db, orgId, callerId,
            candidates,
            projectId: persistedProjectId,
            periodFrom: body.PeriodFrom, periodTo: body.PeriodTo,
            taxPct: taxPct, subtotal: subtotal, taxAmount: taxAmount, total: total,
            notes: body.Notes,
            ct: ct);
        if (invoice is null) return Results.Json(
            new { error = "Could not allocate an invoice number under contention." },
            statusCode: 409);

        await cache.InvalidateTagsAsync(new[] {
            $"org:{orgId:N}:invoices",
            $"org:{orgId:N}:worklogs",
        }, ct);
        await audit.RecordAsync("invoice.generated.from-member", orgId, callerId, "invoice", invoice.Id.ToString(),
            new {
                number = invoice.Number,
                userId = body.UserId,
                projectFilterId = body.ProjectId,
                engagementId,
                lineCount = candidates.Lines.Count,
                total,
            }, ct);

        return Results.Ok(new { id = invoice.Id, number = invoice.Number, total });
    }

    // ---------------------------------------------------------------------
    // GET /{invoiceId} — detail with lines
    // ---------------------------------------------------------------------
    public static async Task<IResult> Get(
        Guid id, Guid invoiceId,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var detail = await GetDetailAsync(db, orgId, invoiceId, ct);
        return detail is null ? Results.NotFound() : Results.Ok(detail);
    }

    private static async Task<InvoiceDetail?> GetDetailAsync(
        TimeFlowDbContext db, Guid orgId, Guid invoiceId, CancellationToken ct) {
        var i = await db.Invoices.AsNoTracking()
            .Where(x => x.Id == invoiceId && x.OrgId == orgId)
            .Join(db.NativeProjects.AsNoTracking(),
                inv => inv.ProjectId, p => p.Id,
                (inv, p) => new { inv, ProjectName = inv.BilledPartyName ?? p.Name })
            .FirstOrDefaultAsync(ct);
        if (i is null) return null;
        var lines = await db.InvoiceLines.AsNoTracking()
            .Where(l => l.InvoiceId == invoiceId)
            .OrderBy(l => l.Ordinal)
            .Select(l => new InvoiceLineItem(
                l.Id, l.WorklogId, l.Description,
                l.Hours, l.BillRate, l.Amount, l.Ordinal,
                // Legacy rows (pre-cadence migration) ship with the additive
                // backfill defaults — quantity=hours, unit='hours', cadence='hourly'.
                // The schema still has these nullable until the TightenInvoiceLineCadence
                // migration lands; guard so historical rows stay shape-correct.
                l.Quantity == 0m ? l.Hours : l.Quantity,
                string.IsNullOrEmpty(l.QuantityUnit) ? "hours" : l.QuantityUnit,
                string.IsNullOrEmpty(l.Cadence) ? "hourly" : l.Cadence))
            .ToListAsync(ct);
        var inv = i.inv;
        return new InvoiceDetail(
            inv.Id, inv.Number, inv.ProjectId, i.ProjectName,
            inv.PeriodFrom, inv.PeriodTo, inv.Status,
            inv.Subtotal, inv.TaxPct, inv.TaxAmount, inv.Total,
            inv.Currency, inv.Notes,
            inv.IssuedAt, inv.DueAt, inv.PaidAt,
            inv.CreatedAt, inv.UpdatedAt,
            lines);
    }

    // ---------------------------------------------------------------------
    // PATCH /{invoiceId} — state transitions + notes + tax (draft only)
    // ---------------------------------------------------------------------
    public sealed record UpdateInvoiceRequest(
        string? Status,
        string? Notes,
        DateTime? IssuedAt,
        DateOnly? DueAt,
        DateTime? PaidAt,
        decimal? TaxPct);

    public static async Task<IResult> Update(
        Guid id, Guid invoiceId, UpdateInvoiceRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var invoice = await db.Invoices.FirstOrDefaultAsync(i => i.Id == invoiceId && i.OrgId == orgId, ct);
        if (invoice is null) return Results.NotFound();

        var oldStatus = invoice.Status;
        if (body.Status is string newStatus) {
            if (!TryTransition(oldStatus, newStatus)) {
                return Results.Conflict(new { error = $"Illegal transition {oldStatus} → {newStatus}." });
            }
            invoice.Status = newStatus;
            if (newStatus == "sent" && invoice.IssuedAt is null) invoice.IssuedAt = DateTime.UtcNow;
            if (newStatus == "paid" && invoice.PaidAt is null) invoice.PaidAt = DateTime.UtcNow;
            if (newStatus == "void") {
                await UnlinkInvoiceWorklogsAsync(db, invoice.Id, ct);
            }
        }
        if (body.Notes is not null) invoice.Notes = body.Notes;
        if (body.IssuedAt is not null) invoice.IssuedAt = body.IssuedAt;
        if (body.DueAt is not null) invoice.DueAt = body.DueAt;
        if (body.PaidAt is not null) invoice.PaidAt = body.PaidAt;
        if (body.TaxPct is decimal newTax) {
            if (invoice.Status != "draft") {
                return Results.Conflict(new { error = "TaxPct change only allowed while draft." });
            }
            if (newTax < 0m || newTax > 100m) return Results.Json(new { error = "TaxPct must be 0-100." }, statusCode: 400);
            invoice.TaxPct = newTax;
            invoice.TaxAmount = decimal.Round(invoice.Subtotal * newTax / 100m, 2);
            invoice.Total = invoice.Subtotal + invoice.TaxAmount;
        }
        invoice.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] {
            $"org:{orgId:N}:invoices",
            $"org:{orgId:N}:worklogs",
        }, ct);
        await audit.RecordAsync("invoice.updated", orgId, callerId, "invoice", invoice.Id.ToString(),
            new { from = oldStatus, to = invoice.Status }, ct);

        return Results.Ok(new { ok = true, status = invoice.Status });
    }

    private static bool TryTransition(string from, string to) {
        if (from == to) return true;
        return (from, to) switch {
            ("draft", "sent") => true,
            ("sent", "paid") => true,
            (_, "void") => true,
            _ => false,
        };
    }

    // ---------------------------------------------------------------------
    // DELETE /{invoiceId} — draft only; cascades lines, clears worklog refs.
    // ---------------------------------------------------------------------
    public static async Task<IResult> Delete(
        Guid id, Guid invoiceId,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var invoice = await db.Invoices.FirstOrDefaultAsync(i => i.Id == invoiceId && i.OrgId == orgId, ct);
        if (invoice is null) return Results.NotFound();
        if (invoice.Status != "draft") {
            return Results.Conflict(new { error = "Only draft invoices can be deleted. Void instead." });
        }

        await UnlinkInvoiceWorklogsAsync(db, invoiceId, ct);
        db.Invoices.Remove(invoice); // cascades lines + invoice_line_worklogs
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] {
            $"org:{orgId:N}:invoices",
            $"org:{orgId:N}:worklogs",
        }, ct);
        await audit.RecordAsync("invoice.deleted", orgId, callerId, "invoice", invoice.Id.ToString(),
            new { number = invoice.Number }, ct);
        return Results.Ok(new { ok = true });
    }

    // Clears every worklog reference back to this invoice. Two pointers
    // exist for symmetry: hourly lines use worklog.invoice_line_id as the
    // hot-path lookup; rollups (daily/monthly) live in invoice_line_worklogs.
    // Both paths get cleared so a void or delete returns ALL backing worklogs
    // to billable.
    private static async Task UnlinkInvoiceWorklogsAsync(
        TimeFlowDbContext db, Guid invoiceId, CancellationToken ct) {
        var lineIds = await db.InvoiceLines
            .Where(l => l.InvoiceId == invoiceId)
            .Select(l => l.Id)
            .ToListAsync(ct);
        if (lineIds.Count == 0) return;

        var direct = await db.Worklogs
            .Where(w => w.InvoiceLineId != null && lineIds.Contains(w.InvoiceLineId!.Value))
            .ToListAsync(ct);
        foreach (var w in direct) w.InvoiceLineId = null;

        var sidecarWorklogIds = await db.InvoiceLineWorklogs
            .Where(ilw => lineIds.Contains(ilw.InvoiceLineId))
            .Select(ilw => ilw.WorklogId)
            .ToListAsync(ct);
        if (sidecarWorklogIds.Count > 0) {
            var rollupWorklogs = await db.Worklogs
                .Where(w => sidecarWorklogIds.Contains(w.Id) && w.InvoiceLineId != null)
                .ToListAsync(ct);
            foreach (var w in rollupWorklogs) w.InvoiceLineId = null;
            // Cascade DELETE on the invoice line will sweep these rows when
            // the line goes away. For void we keep the line but clear the
            // mapping to free the worklogs.
            var sidecars = await db.InvoiceLineWorklogs
                .Where(ilw => lineIds.Contains(ilw.InvoiceLineId))
                .ToListAsync(ct);
            db.InvoiceLineWorklogs.RemoveRange(sidecars);
        }
    }

    // ---------------------------------------------------------------------
    // GET /{invoiceId}/pdf — streams an A4 PDF
    // ---------------------------------------------------------------------
    public static async Task<IResult> DownloadPdf(
        Guid id, Guid invoiceId,
        TimeFlowDbContext db,
        IInvoicePdfRenderer renderer,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var detail = await GetDetailAsync(db, orgId, invoiceId, ct);
        if (detail is null) return Results.NotFound();
        var org = await db.Organisations.AsNoTracking().FirstAsync(o => o.Id == orgId, ct);
        var project = await db.NativeProjects.AsNoTracking().FirstAsync(p => p.Id == detail.ProjectId, ct);

        var payload = new InvoicePayload(
            Number: detail.Number,
            Currency: detail.Currency,
            PeriodFrom: detail.PeriodFrom,
            PeriodTo: detail.PeriodTo,
            IssuedAt: detail.IssuedAt,
            DueAt: detail.DueAt,
            Notes: detail.Notes,
            Subtotal: detail.Subtotal,
            TaxPct: detail.TaxPct,
            TaxAmount: detail.TaxAmount,
            Total: detail.Total,
            Org: new OrgPayload(org.Name),
            Client: new ClientPayload(detail.ProjectName, project.ContactName, project.ContactEmail, project.TaxId, project.Address),
            Lines: detail.Lines
                .Select(l => new InvoiceLinePayload(
                    l.Description, l.Hours, l.BillRate, l.Amount,
                    l.Quantity, l.QuantityUnit))
                .ToList());
        var bytes = renderer.Render(payload);
        return Results.File(bytes, contentType: "application/pdf",
            fileDownloadName: $"{detail.Number}.pdf");
    }

    // ---------------------------------------------------------------------
    // Cadence-aware candidate-line gathering
    // ---------------------------------------------------------------------
    public sealed record CandidateLine(
        Guid? WorklogId, string Description,
        decimal Hours, decimal BillRate, decimal Amount,
        decimal Quantity, string QuantityUnit, string Cadence,
        IReadOnlyList<Guid> BackingWorklogIds);

    private sealed record CandidateBundle(
        string BilledPartyName, string Currency,
        IReadOnlyList<CandidateLine> Lines,
        IReadOnlyList<string> Warnings,
        IReadOnlyList<Guid> CandidateEngagementIds,
        Guid? PrimaryEngagementId);

    // Single resolver for both project-target and member-target invoices.
    //   * projectFilterId  scopes to the engagement subtree (descendant ids)
    //   * memberFilterId   scopes to one user's worklogs
    // Either or both can be set. Returns null only when the project filter
    // points at a non-existent / cross-org project.
    private static async Task<CandidateBundle?> GatherCandidateLinesAsync(
        TimeFlowDbContext db,
        ProjectPolicyResolver policy,
        Guid orgId,
        Guid? projectFilterId, Guid? memberFilterId,
        DateOnly periodFrom, DateOnly periodTo,
        CancellationToken ct) {

        NativeProject? engagement = null;
        List<Guid>? subtree = null;
        if (projectFilterId is Guid pfId) {
            engagement = await db.NativeProjects.AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == pfId && p.OrgId == orgId, ct);
            if (engagement is null) return null;
            subtree = await ProjectTreeHelper.DescendantProjectIdsAsync(db, orgId, pfId, ct);
        }
        var org = await db.Organisations.AsNoTracking().FirstAsync(o => o.Id == orgId, ct);

        // Pull the candidate worklog set first; we let the per-row data drive
        // which projects/users we need cadence + rate info for.
        var rowsQuery =
            from w in db.Worklogs.AsNoTracking()
            join p in db.NativeProjects.AsNoTracking() on w.ProjectId equals p.Id
            join t in db.NativeTasks.AsNoTracking() on w.TaskId equals t.Id into tj
            from t in tj.DefaultIfEmpty()
            where w.OrgId == orgId
                && w.IsBillable
                && w.InvoiceLineId == null
                && w.WorkDate >= periodFrom && w.WorkDate <= periodTo
                && w.ProjectId != null
            select new {
                w.Id, w.UserId, w.Hours, w.WorkDate, w.Notes,
                ProjectId = w.ProjectId!.Value,
                ProjectName = p.Name,
                TaskTitle = t != null ? t.Title : null,
                UpstreamTaskId = t != null ? t.UpstreamTaskId : null,
            };
        if (subtree is not null) {
            // Defensive: empty subtree means project exists but has no
            // descendants and itself; ToListAsync returns []. Same end result.
            rowsQuery = rowsQuery.Where(r => subtree.Contains(r.ProjectId));
        }
        if (memberFilterId is Guid mfId) {
            rowsQuery = rowsQuery.Where(r => r.UserId == mfId);
        }
        var rows = await rowsQuery.ToListAsync(ct);

        var lines = new List<CandidateLine>();
        var warnings = new List<string>();

        if (rows.Count == 0) {
            // Still need an engagement label + candidate engagement list (may
            // be empty for member-target with no worklogs).
            var billedEmpty = engagement is not null
                ? (string.IsNullOrWhiteSpace(engagement.ContactName)
                    ? engagement.Name : engagement.ContactName!)
                : await ResolveMemberDisplayNameAsync(db, orgId, memberFilterId, ct);
            return new CandidateBundle(
                billedEmpty ?? "—", org.Currency, lines, warnings,
                CandidateEngagementIds: Array.Empty<Guid>(),
                PrimaryEngagementId: engagement?.Id);
        }

        // Resolve cadence per distinct user in scope. NULL pay_cadence is
        // the legacy "hourly" sentinel; same normalisation as MemberSummary.
        var userIds = rows.Select(r => r.UserId).Distinct().ToList();
        var memberRowsList = await db.OrgMemberships.AsNoTracking()
            .Where(m => m.OrgId == orgId && userIds.Contains(m.UserId))
            .Join(db.Users.AsNoTracking(), m => m.UserId, u => u.Id, (m, u) => new MemberRow(
                m.UserId, u.Name, u.Email,
                m.PayCadence, m.CostPerHour, m.DailyRate, m.MonthlyRate))
            .ToListAsync(ct);
        var memberByUserId = memberRowsList.ToDictionary(m => m.UserId);
        string CadenceOf(Guid uid) {
            if (!memberByUserId.TryGetValue(uid, out var m)) return "hourly";
            var c = (m.PayCadence ?? "hourly").Trim().ToLowerInvariant();
            return c is "hourly" or "daily" or "monthly" ? c : "hourly";
        }

        // Engagement (root project) resolution for every project touched —
        // we need this both for cross-engagement detection in member-target
        // mode AND to walk the ancestor chain for the rate cascade.
        var allProjectIds = new HashSet<Guid>(rows.Select(r => r.ProjectId));
        var (parentOf, projectMeta, engagementOf) =
            await LoadProjectChainAsync(db, orgId, allProjectIds, ct);

        // For the HOURLY rate cascade, also load every project_members row
        // for projects in the chain whose user_id is one of ours.
        var allChainProjectIds = projectMeta.Keys.ToList();
        var pmRows = await db.ProjectMembers.AsNoTracking()
            .Where(pm => pm.OrgId == orgId
                && allChainProjectIds.Contains(pm.ProjectId)
                && pm.CostPerHour != null
                && userIds.Contains(pm.UserId))
            .Select(pm => new { pm.ProjectId, pm.UserId, pm.CostPerHour })
            .ToListAsync(ct);
        var rateMap = pmRows
            .GroupBy(r => (r.ProjectId, r.UserId))
            .ToDictionary(g => g.Key, g => g.First().CostPerHour!.Value);

        decimal? WalkHourlyRate(Guid leafProjectId, Guid userId) {
            // 1. Walk project_members.cost_per_hour up the chain — nearest
            //    ancestor wins.
            var cursor = (Guid?)leafProjectId;
            var guard = 0;
            while (cursor is Guid pid && guard++ < 64) {
                if (rateMap.TryGetValue((pid, userId), out var r)) return r;
                cursor = parentOf.GetValueOrDefault(pid);
            }
            // 2. Walk project.bill_rate up the chain.
            cursor = leafProjectId;
            guard = 0;
            while (cursor is Guid pid && guard++ < 64) {
                if (projectMeta.TryGetValue(pid, out var meta) && meta.BillRate is decimal br) return br;
                cursor = parentOf.GetValueOrDefault(pid);
            }
            // 3. Walk project.default_bill_rate up the chain.
            cursor = leafProjectId;
            guard = 0;
            while (cursor is Guid pid && guard++ < 64) {
                if (projectMeta.TryGetValue(pid, out var meta) && meta.DefaultBillRate is decimal dbr) return dbr;
                cursor = parentOf.GetValueOrDefault(pid);
            }
            // 4. Fall back to cost_per_hour at any ancestor again — "no
            //    markup" mode used when only cost is configured.
            cursor = leafProjectId;
            guard = 0;
            while (cursor is Guid pid && guard++ < 64) {
                if (rateMap.TryGetValue((pid, userId), out var r)) return r;
                cursor = parentOf.GetValueOrDefault(pid);
            }
            return null;
        }

        // Track distinct engagements present in this candidate set so the
        // member-target endpoint can surface a client picker when needed.
        var engagementsSeen = new HashSet<Guid>();
        foreach (var r in rows) {
            if (engagementOf.TryGetValue(r.ProjectId, out var eng)) {
                engagementsSeen.Add(eng);
            }
        }

        // ---------- Emit lines per cadence bucket ----------
        var hourlyRows = rows.Where(r => CadenceOf(r.UserId) == "hourly").ToList();
        var dailyRows = rows.Where(r => CadenceOf(r.UserId) == "daily").ToList();
        var monthlyRows = rows.Where(r => CadenceOf(r.UserId) == "monthly").ToList();

        // Hourly lines: one per worklog (existing grain).
        foreach (var r in hourlyRows) {
            var rate = WalkHourlyRate(r.ProjectId, r.UserId);
            if (rate is not decimal rateValue) {
                warnings.Add($"Skipped worklog {r.Id:N} — no rate configured.");
                continue;
            }
            var amount = decimal.Round(r.Hours * rateValue, 2);
            string descBody;
            if (!string.IsNullOrWhiteSpace(r.UpstreamTaskId) && !string.IsNullOrWhiteSpace(r.TaskTitle)) {
                descBody = $"#{r.UpstreamTaskId} {r.TaskTitle}";
            } else if (!string.IsNullOrWhiteSpace(r.TaskTitle)) {
                descBody = $"{r.ProjectName} · {r.TaskTitle}";
            } else {
                descBody = r.ProjectName;
            }
            var desc = string.IsNullOrWhiteSpace(r.Notes)
                ? $"{descBody} · {r.WorkDate:yyyy-MM-dd}"
                : $"{descBody} · {r.WorkDate:yyyy-MM-dd} · {r.Notes}";
            lines.Add(new CandidateLine(
                WorklogId: r.Id, Description: desc,
                Hours: r.Hours, BillRate: rateValue, Amount: amount,
                Quantity: r.Hours, QuantityUnit: "hours", Cadence: "hourly",
                BackingWorklogIds: new[] { r.Id }));
        }

        // Daily lines: one per (member, project).
        foreach (var grp in dailyRows.GroupBy(r => (r.UserId, r.ProjectId))) {
            var (uid, projId) = grp.Key;
            if (!memberByUserId.TryGetValue(uid, out var member) || member.DailyRate is not decimal dailyRate) {
                warnings.Add($"Skipped {grp.First().ProjectName} for member {DisplayNameFor(member)} — daily_rate not set.");
                continue;
            }
            var distinctDays = grp.Select(g => g.WorkDate).Distinct().Count();
            var loggedHours = grp.Sum(g => g.Hours);
            var amount = decimal.Round(distinctDays * dailyRate, 2);
            var projectName = grp.First().ProjectName;
            var memberLabel = DisplayNameFor(member);
            lines.Add(new CandidateLine(
                WorklogId: null,
                Description: $"{projectName} · {memberLabel} · {distinctDays} dias",
                Hours: loggedHours, BillRate: dailyRate, Amount: amount,
                Quantity: distinctDays, QuantityUnit: "days", Cadence: "daily",
                BackingWorklogIds: grp.Select(g => g.Id).ToList()));
        }

        // Monthly lines: one per member (cross-project rollup).
        if (monthlyRows.Count > 0) {
            // ExpectedHours scoping: per-project policy when a filter is set,
            // else org-level. Resolver hits the cache for the org cascade.
            decimal expectedHours;
            if (projectFilterId is Guid filteredProj) {
                expectedHours = await ResolveExpectedHoursForProjectAsync(
                    db, policy, orgId, filteredProj, periodFrom, periodTo, ct);
            } else {
                expectedHours = await ResolveExpectedHoursForOrgAsync(
                    db, orgId, periodFrom, periodTo, ct);
            }

            // Detect "monthly member has hours outside the filter" by re-
            // querying with NO subtree filter; flag those members in warnings
            // so the UI can render the per-line caveat.
            HashSet<Guid> membersWithOutsideHours = new();
            if (projectFilterId is Guid filteredProj2) {
                var monthlyUserIds = monthlyRows.Select(r => r.UserId).Distinct().ToList();
                var outsideQ =
                    from w in db.Worklogs.AsNoTracking()
                    where w.OrgId == orgId
                        && w.IsBillable
                        && w.InvoiceLineId == null
                        && w.WorkDate >= periodFrom && w.WorkDate <= periodTo
                        && monthlyUserIds.Contains(w.UserId)
                        && w.ProjectId != null
                        && !subtree!.Contains(w.ProjectId!.Value)
                    select w.UserId;
                var outsideUsers = await outsideQ.Distinct().ToListAsync(ct);
                foreach (var u in outsideUsers) membersWithOutsideHours.Add(u);
            }

            foreach (var grp in monthlyRows.GroupBy(r => r.UserId)) {
                var uid = grp.Key;
                if (!memberByUserId.TryGetValue(uid, out var member) || member.MonthlyRate is not decimal monthlyRate) {
                    warnings.Add($"Skipped member {DisplayNameFor(member)} — monthly_rate not set.");
                    continue;
                }
                if (expectedHours <= 0m) {
                    warnings.Add($"Skipped member {DisplayNameFor(member)} — expected hours = 0 in window.");
                    continue;
                }
                var loggedHours = grp.Sum(g => g.Hours);
                var ratio = loggedHours / expectedHours;
                if (ratio > 1m) ratio = 1m;
                if (ratio < 0m) ratio = 0m;
                var amount = decimal.Round(monthlyRate * ratio, 2);
                var memberLabel = DisplayNameFor(member);
                var monthLabel = $"{periodFrom:yyyy-MM-dd}..{periodTo:yyyy-MM-dd}";
                var pct = decimal.Round(ratio * 100m, 0);
                var desc = $"{memberLabel} · {monthLabel} · {pct.ToString("0", CultureInfo.InvariantCulture)}% do mes";
                lines.Add(new CandidateLine(
                    WorklogId: null,
                    Description: desc,
                    Hours: loggedHours, BillRate: monthlyRate, Amount: amount,
                    Quantity: decimal.Round(ratio, 4), QuantityUnit: "months", Cadence: "monthly",
                    BackingWorklogIds: grp.Select(g => g.Id).ToList()));
                if (membersWithOutsideHours.Contains(uid)) {
                    warnings.Add($"Member {memberLabel} has hours outside the project filter — monthly pro-ration uses filtered hours only.");
                }
            }
        }

        // ---------- Billed-party label + engagement disambiguation ----------
        string billedPartyName;
        Guid? primaryEngagementId = engagement?.Id;
        if (engagement is not null) {
            billedPartyName = string.IsNullOrWhiteSpace(engagement.ContactName)
                ? engagement.Name : engagement.ContactName!;
        } else if (memberFilterId is Guid uid && memberByUserId.TryGetValue(uid, out var m)) {
            billedPartyName = DisplayNameFor(m);
            // No explicit engagement filter — pick the most-touched engagement
            // in the window as a default. Caller can override via clientId.
            primaryEngagementId = engagementsSeen
                .Select(e => new {
                    Id = e,
                    Hours = rows.Where(r => engagementOf.GetValueOrDefault(r.ProjectId) == e).Sum(r => r.Hours)
                })
                .OrderByDescending(x => x.Hours)
                .Select(x => (Guid?)x.Id)
                .FirstOrDefault();
        } else {
            billedPartyName = "—";
        }

        return new CandidateBundle(
            billedPartyName, org.Currency, lines, warnings,
            CandidateEngagementIds: engagementsSeen.ToList(),
            PrimaryEngagementId: primaryEngagementId);
    }

    // Per-member projection used both for cadence routing and rate lookup.
    private sealed record MemberRow(
        Guid UserId, string Name, string Email,
        string? PayCadence, decimal? CostPerHour, decimal? DailyRate, decimal? MonthlyRate);

    private static string DisplayNameFor(MemberRow? m) {
        if (m is null) return "—";
        if (!string.IsNullOrWhiteSpace(m.Name)) return m.Name;
        if (!string.IsNullOrWhiteSpace(m.Email)) return m.Email;
        return "—";
    }

    private static async Task<string?> ResolveMemberDisplayNameAsync(
        TimeFlowDbContext db, Guid orgId, Guid? userId, CancellationToken ct) {
        if (userId is not Guid uid) return null;
        var u = await db.OrgMemberships.AsNoTracking()
            .Where(m => m.OrgId == orgId && m.UserId == uid)
            .Join(db.Users.AsNoTracking(), m => m.UserId, x => x.Id, (m, x) => new { x.Name, x.Email })
            .FirstOrDefaultAsync(ct);
        if (u is null) return null;
        return string.IsNullOrWhiteSpace(u.Name) ? u.Email : u.Name;
    }

    // Walks the parent chain for every project we touched, plus all ancestors,
    // and returns:
    //   - parent-of map (for rate cascade walks)
    //   - project meta (BillRate / DefaultBillRate for the cascade)
    //   - engagement-of map (rooted at the topmost parent — the "client")
    private static async Task<(
        Dictionary<Guid, Guid?> parentOf,
        Dictionary<Guid, (decimal? BillRate, decimal? DefaultBillRate)> projectMeta,
        Dictionary<Guid, Guid> engagementOf)> LoadProjectChainAsync(
            TimeFlowDbContext db, Guid orgId, HashSet<Guid> seedProjectIds, CancellationToken ct) {
        var parentOf = new Dictionary<Guid, Guid?>();
        var meta = new Dictionary<Guid, (decimal? BillRate, decimal? DefaultBillRate)>();

        var frontier = seedProjectIds.ToList();
        while (frontier.Count > 0) {
            var batch = await db.NativeProjects.AsNoTracking()
                .Where(p => p.OrgId == orgId && frontier.Contains(p.Id))
                .Select(p => new { p.Id, p.ParentProjectId, p.BillRate, p.DefaultBillRate })
                .ToListAsync(ct);
            var next = new List<Guid>();
            foreach (var p in batch) {
                parentOf[p.Id] = p.ParentProjectId;
                meta[p.Id] = (p.BillRate, p.DefaultBillRate);
                if (p.ParentProjectId is Guid pp && !parentOf.ContainsKey(pp)) next.Add(pp);
            }
            frontier = next;
        }

        var engagementOf = new Dictionary<Guid, Guid>();
        foreach (var pid in seedProjectIds) {
            var cursor = pid;
            var guard = 0;
            while (parentOf.TryGetValue(cursor, out var parent) && parent is Guid p && guard++ < 64) {
                cursor = p;
            }
            engagementOf[pid] = cursor;
        }
        return (parentOf, meta, engagementOf);
    }

    // Per-project expected-hours: resolve nearest-ancestor policy and sum
    // over the window. Mirrors MemberSummaryEndpoints.ResolveExpectedHoursAsync
    // but uses the project policy resolver instead of the raw org row.
    private static async Task<decimal> ResolveExpectedHoursForProjectAsync(
        TimeFlowDbContext db, ProjectPolicyResolver resolver,
        Guid orgId, Guid projectId,
        DateOnly from, DateOnly to, CancellationToken ct) {
        var resolved = await resolver.ResolveAsync(orgId, projectId, ct);
        var (schedule, holidays) = ProjectPolicyResolver.Materialise(resolved);
        return ScheduleResolver.SumExpectedHours(from, to, schedule, holidays);
    }

    private static async Task<decimal> ResolveExpectedHoursForOrgAsync(
        TimeFlowDbContext db, Guid orgId,
        DateOnly from, DateOnly to, CancellationToken ct) {
        var policy = await db.Organisations.AsNoTracking()
            .Where(o => o.Id == orgId)
            .Select(o => new { o.ScheduleConfigJson, o.HolidayProfileJson })
            .FirstOrDefaultAsync(ct);

        OrgScheduleConfig schedule = SchedulePresets.Default;
        OrgHolidayProfile holidays = new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey };
        var jsonOpts = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        if (policy is not null) {
            if (!string.IsNullOrWhiteSpace(policy.ScheduleConfigJson)) {
                try {
                    schedule = System.Text.Json.JsonSerializer.Deserialize<OrgScheduleConfig>(
                        policy.ScheduleConfigJson, jsonOpts) ?? SchedulePresets.Default;
                } catch { schedule = SchedulePresets.Default; }
            }
            if (!string.IsNullOrWhiteSpace(policy.HolidayProfileJson)) {
                try {
                    holidays = System.Text.Json.JsonSerializer.Deserialize<OrgHolidayProfile>(
                        policy.HolidayProfileJson, jsonOpts)
                        ?? new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey };
                } catch { holidays = new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey }; }
            }
        }
        return ScheduleResolver.SumExpectedHours(from, to, schedule, holidays);
    }

    // ---------------------------------------------------------------------
    // Internal: invoice mint + persist (shared between project-target and
    // member-target generate paths)
    // ---------------------------------------------------------------------
    private static async Task<Invoice?> PersistInvoiceAsync(
        TimeFlowDbContext db,
        Guid orgId, Guid? callerId,
        CandidateBundle candidates,
        Guid projectId,
        DateOnly periodFrom, DateOnly periodTo,
        decimal taxPct, decimal subtotal, decimal taxAmount, decimal total,
        string? notes,
        CancellationToken ct) {
        // Sequential number per (org, year), minted read-max-then-write with
        // a unique-index race retry — see commentary in pre-cadence version
        // of this code; preserved verbatim because it's still load-bearing
        // under concurrent generate calls.
        const int maxAttempts = 5;
        Invoice? invoice = null;
        for (var attempt = 1; ; attempt++) {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try {
                var year = DateTime.UtcNow.Year;
                var prefix = $"INV-{year}-";
                var lastNumber = await db.Invoices.AsNoTracking()
                    .Where(i => i.OrgId == orgId && i.Number.StartsWith(prefix))
                    .OrderByDescending(i => i.Number)
                    .Select(i => i.Number)
                    .FirstOrDefaultAsync(ct);
                var seq = 1;
                if (lastNumber is not null
                    && int.TryParse(lastNumber.AsSpan(prefix.Length), out var parsed)) {
                    seq = parsed + 1;
                }
                var invoiceNumber = prefix + seq.ToString("D4");

                invoice = new Invoice {
                    OrgId = orgId,
                    ProjectId = projectId,
                    BilledPartyName = candidates.BilledPartyName,
                    Number = invoiceNumber,
                    PeriodFrom = periodFrom,
                    PeriodTo = periodTo,
                    Status = "draft",
                    Subtotal = subtotal,
                    TaxPct = taxPct,
                    TaxAmount = taxAmount,
                    Total = total,
                    Currency = candidates.Currency,
                    Notes = notes,
                    CreatedBy = callerId,
                };
                db.Invoices.Add(invoice);
                await db.SaveChangesAsync(ct);

                var ord = 0;
                foreach (var c in candidates.Lines) {
                    var line = new InvoiceLine {
                        InvoiceId = invoice.Id,
                        WorklogId = c.WorklogId,
                        Description = c.Description,
                        Hours = c.Hours,
                        BillRate = c.BillRate,
                        Amount = c.Amount,
                        Quantity = c.Quantity,
                        QuantityUnit = c.QuantityUnit,
                        Cadence = c.Cadence,
                        Ordinal = ++ord,
                    };
                    db.InvoiceLines.Add(line);
                    if (c.WorklogId is Guid wid) {
                        var w = await db.Worklogs.FirstAsync(x => x.Id == wid, ct);
                        w.InvoiceLineId = line.Id;
                    } else {
                        // Rollup lines: flip every backing worklog's pointer to
                        // this line (hot-path index for paycheck/billing reads)
                        // AND insert the sidecar entries for enumerability.
                        foreach (var backingId in c.BackingWorklogIds) {
                            var bw = await db.Worklogs.FirstAsync(x => x.Id == backingId, ct);
                            bw.InvoiceLineId = line.Id;
                            db.InvoiceLineWorklogs.Add(new InvoiceLineWorklog {
                                InvoiceLineId = line.Id,
                                WorklogId = backingId,
                            });
                        }
                    }
                }
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
                break;
            } catch (DbUpdateException ex)
                  when (IsInvoiceNumberCollision(ex) && attempt < maxAttempts) {
                await tx.RollbackAsync(ct);
                ResetTracker(db);
            }
        }
        return invoice;
    }

    private static bool IsInvoiceNumberCollision(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505";

    private static void ResetTracker(TimeFlowDbContext db) {
        foreach (var entry in db.ChangeTracker.Entries().ToList()) {
            entry.State = EntityState.Detached;
        }
    }

    private static (decimal subtotal, decimal taxAmount, decimal total) ComputeTotals(
        IReadOnlyList<CandidateLine> lines, decimal taxPct) {
        var subtotal = decimal.Round(lines.Sum(l => l.Amount), 2);
        var taxAmount = decimal.Round(subtotal * taxPct / 100m, 2);
        var total = subtotal + taxAmount;
        return (subtotal, taxAmount, total);
    }
}
