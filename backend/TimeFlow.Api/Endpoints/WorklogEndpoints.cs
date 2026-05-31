using System.ComponentModel.DataAnnotations;
using Hangfire;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/worklogs — per-user hour entries.
//
// Scope rules:
//   * Listing your own logs: WorklogsReadOwn (developer+)
//   * Listing someone else's by ?userId=: WorklogsReadSquad (tech_lead+)
//     for squad scope, WorklogsReadOrg (manager+) for unrestricted.
//     Phase 6 enforces ONLY own-or-org because squad scoping needs the
//     squad_members table joined in; that lands later.
//   * Writing: WorklogsWriteOwn (developer+) — endpoints always write
//     against the caller's userId. Admin-on-behalf-of is Phase 11.
//
// Date math is whole-day (DateOnly) — partial-day hours go in `hours`.
public static class WorklogEndpoints {
    public static void MapWorklogEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/worklogs").RequireAuthorization();

        grp.MapGet("", List).RequireOrgPermission(Permission.WorklogsReadOwn);
        grp.MapPost("", Create).RequireOrgPermission(Permission.WorklogsWriteOwn);
        grp.MapPost("/bulk", CreateBulk).RequireOrgPermission(Permission.WorklogsWriteOwn);
        grp.MapPatch("/{worklogId:guid}", Update).RequireOrgPermission(Permission.WorklogsWriteOwn);
        grp.MapDelete("/{worklogId:guid}", Delete).RequireOrgPermission(Permission.WorklogsWriteOwn);
    }

    public sealed record WorklogItem(
        Guid Id, Guid UserId,
        Guid? ProjectId, Guid? TaskId,
        // Denormalised — the upstream project id reached via the task's
        // project (the mirror tuple lives on NativeProject now). Null when
        // the worklog targets a locally-created project/task.
        string? UpstreamProjectId,
        DateOnly WorkDate, decimal Hours, string? Notes, string? Source,
        string PushStatus, string? UpstreamWorklogId, string? PushErrorCode,
        DateTime CreatedAt,
        bool IsBillable,
        // Derived: "non_billable" | "billable" | "billed". Lets the UI badge
        // the row's billing state without re-deriving on the client.
        string BillingStatus);

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/worklogs?from=YYYY-MM-DD&to=YYYY-MM-DD&userId=...&projectId=...
    // ---------------------------------------------------------------------
    public static async Task<IResult> List(
        Guid id,
        DateOnly? from, DateOnly? to, Guid? userId, Guid? projectId,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        if (callerId is null) return Results.Unauthorized();

        var target = userId ?? callerId.Value;
        if (target != callerId.Value) {
            // Reading someone else's logs needs an org-wide gate. Squad
            // scope (manager-of-squad) lands when squad_members joins
            // get wired in.
            if (!PermissionMatrix.Can(role, Permission.WorklogsReadOrg)) {
                return Results.Forbid();
            }
        }

        // Default to current month if no range supplied — most calls are
        // "give me this month's calendar" anyway.
        var fromDate = from ?? new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        var toDate = to ?? fromDate.AddMonths(1).AddDays(-1);
        if (toDate < fromDate) return Results.Json(new { error = "to < from." }, statusCode: 400);
        if ((toDate.DayNumber - fromDate.DayNumber) > 366) {
            return Results.Json(new { error = "Range too wide (max 1 year)." }, statusCode: 400);
        }

        // When a project is supplied, expand to its whole subtree so worklogs
        // on leaf sub-projects (Re INOVAR) roll up under the engagement the
        // caller picked in the TopBar switcher (Accenture). Without this the
        // filter would exact-match the engagement id and miss every leaf.
        List<Guid>? projectScope = null;
        if (projectId is { } pid) {
            projectScope = await ProjectTreeHelper.DescendantProjectIdsAsync(db, orgId, pid, ct);
            if (projectScope.Count == 0) {
                // Project not in org → don't leak existence; return empty.
                return Results.Ok(Array.Empty<WorklogItem>());
            }
        }

        // Key encodes every dimension that changes the result: org, user,
        // project filter, and the exact date window. Without target in the
        // key, a manager's query for user A would be served from user B's
        // cached slice.
        var projectKey = projectId is { } pk ? pk.ToString("N") : "all";
        var cacheKey = $"org:{orgId:N}:worklogs:u:{target:N}:p:{projectKey}:{fromDate:yyyyMMdd}:{toDate:yyyyMMdd}";
        var logs = await cache.GetOrSetAsync(
            key: cacheKey,
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:worklogs" },
            loader: async ct2 => {
                var q = db.Worklogs
                    .Where(w => w.OrgId == orgId && w.UserId == target
                        && w.WorkDate >= fromDate && w.WorkDate <= toDate);
                if (projectScope is not null) {
                    // Match worklogs whose project lies in the subtree OR
                    // whose task belongs to a project in the subtree (task-
                    // level worklogs reach the engagement via task.ProjectId).
                    q = q.Where(w =>
                        (w.ProjectId != null && projectScope.Contains(w.ProjectId.Value))
                        || (w.TaskId != null && db.NativeTasks
                            .Any(t => t.Id == w.TaskId && projectScope.Contains(t.ProjectId))));
                }
                return await q
                .OrderBy(w => w.WorkDate).ThenBy(w => w.CreatedAt)
                .Select(w => new WorklogItem(w.Id, w.UserId,
                    w.ProjectId, w.TaskId,
                    // The mirror tuple lives on NativeProject now, so the
                    // calendar-facing upstreamProjectId is reached via the
                    // worklog's project (whether picked directly via
                    // ProjectId or via the task's project). EF Core 8
                    // translates this correlated subquery to a single
                    // LEFT JOIN LATERAL — no N+1.
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
                    // Derived state: invoiced rows are "billed"; otherwise
                    // billable vs non-billable from the flag.
                    w.InvoiceLineId != null ? "billed"
                        : (w.IsBillable ? "billable" : "non_billable")))
                .ToListAsync(ct2);
            },
            ct: ct);

        return Results.Ok(logs);
    }

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/worklogs
    // ---------------------------------------------------------------------
    public sealed record CreateWorklogRequest(
        Guid? ProjectId,
        Guid? TaskId,
        [Required] DateOnly WorkDate,
        [Required, Range(0.0, 24.0)] decimal Hours,
        string? Notes,
        string? Source,
        // Caller-set override. Null = "use the project default" — billable
        // when the worklog's project has a client_id reachable up the
        // hierarchy (or carries one directly).
        bool? IsBillable);

    public static async Task<IResult> Create(
        Guid id,
        CreateWorklogRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        IBackgroundJobClient hangfire,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var (orgId, _) = http.RequireOrgContext();
        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        // Phase C: one channel. The caller picks a project (always) and
        // optionally a task under it. Tasks that mirror an upstream tracker
        // carry their (ConnectionId, UpstreamTaskId) tuple on the NativeTask
        // row, so the push job can look it up from there.
        if (body.ProjectId is null) {
            return Results.Json(new { error = "projectId is required." }, statusCode: 400);
        }

        if (!await ProjectBelongsToOrgAsync(db, orgId, body.ProjectId.Value, body.TaskId, ct)) {
            return Results.Json(new { error = "Project or task not found in this org." }, statusCode: 400);
        }

        // Resolve project shape: DefaultBillRate as a proxy for "is this a
        // billable engagement?"; the task's mirror tuple to decide whether
        // to push upstream. One trip each, no joins — the rows are tiny.
        var projectMeta = await db.NativeProjects
            .Where(p => p.Id == body.ProjectId.Value)
            .Select(p => new { p.DefaultBillRate, p.BillRate, p.UpstreamProjectId })
            .FirstOrDefaultAsync(ct);
        var taskMeta = body.TaskId is Guid tid
            ? await db.NativeTasks
                .Where(t => t.Id == tid)
                .Select(t => new { t.ConnectionId, t.UpstreamTaskId })
                .FirstOrDefaultAsync(ct)
            : null;
        var pushesUpstream = taskMeta?.ConnectionId is Guid && taskMeta.UpstreamTaskId != null;

        // Default billable: explicit override wins; otherwise true when
        // the project itself looks billable (has any rate set — either
        // BillRate or DefaultBillRate). Members can still flip per row.
        var defaultBillable = projectMeta?.DefaultBillRate != null || projectMeta?.BillRate != null;
        var isBillable = body.IsBillable ?? defaultBillable;

        var worklog = new Worklog {
            OrgId = orgId,
            UserId = userId.Value,
            ProjectId = body.ProjectId,
            TaskId = body.TaskId,
            WorkDate = body.WorkDate,
            Hours = body.Hours,
            Notes = body.Notes,
            Source = string.IsNullOrWhiteSpace(body.Source) ? "manual" : body.Source.Trim().ToLowerInvariant(),
            // Tasks carrying a mirror tuple get pushed; everything else
            // stays "none" forever (locally-created tasks/projects).
            PushStatus = pushesUpstream ? "pending" : "none",
            IsBillable = isBillable,
        };
        db.Worklogs.Add(worklog);
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:worklogs" }, ct);

        // Enqueue the upstream push AFTER persisting so the worker can
        // always find the row. Non-blocking — returns immediately.
        if (pushesUpstream) {
            hangfire.Enqueue<WorklogPushJob>(w => w.PushAsync(worklog.Id));
        }

        await audit.RecordAsync("worklog.created", orgId, userId, "worklog", worklog.Id.ToString(),
            new { projectId = worklog.ProjectId, date = worklog.WorkDate, hours = worklog.Hours }, ct);

        return Results.Ok(new WorklogItem(worklog.Id, worklog.UserId,
            worklog.ProjectId, worklog.TaskId,
            projectMeta?.UpstreamProjectId,
            worklog.WorkDate, worklog.Hours, worklog.Notes, worklog.Source,
            worklog.PushStatus, worklog.UpstreamWorklogId, worklog.PushErrorCode,
            worklog.CreatedAt,
            worklog.IsBillable,
            worklog.IsBillable ? "billable" : "non_billable"));
    }

    // ---------------------------------------------------------------------
    // PATCH /api/orgs/{id}/worklogs/{worklogId}
    // Toggle billable / edit notes on an existing entry. Refuses if the
    // worklog is already on an invoice (must void the invoice first).
    // ---------------------------------------------------------------------
    public sealed record UpdateWorklogRequest(
        bool? IsBillable,
        string? Notes);

    public static async Task<IResult> Update(
        Guid id, Guid worklogId,
        UpdateWorklogRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        var worklog = await db.Worklogs
            .FirstOrDefaultAsync(w => w.Id == worklogId && w.OrgId == orgId && w.UserId == userId.Value, ct);
        if (worklog is null) return Results.NotFound();

        if (worklog.InvoiceLineId is not null) {
            return Results.Conflict(new {
                error = "Worklog is on an invoice. Void the invoice before editing.",
                code = "invoiced",
            });
        }

        if (body.IsBillable is bool b) worklog.IsBillable = b;
        if (body.Notes is not null) worklog.Notes = body.Notes;
        worklog.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:worklogs" }, ct);
        await audit.RecordAsync("worklog.updated", orgId, userId, "worklog", worklog.Id.ToString(),
            new { isBillable = worklog.IsBillable }, ct);

        return Results.Ok(new {
            ok = true,
            isBillable = worklog.IsBillable,
            notes = worklog.Notes,
        });
    }

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/worklogs/bulk — common AI/import path
    // ---------------------------------------------------------------------
    public sealed record BulkWorklogRequest(IReadOnlyList<CreateWorklogRequest> Items);

    public static async Task<IResult> CreateBulk(
        Guid id,
        BulkWorklogRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (body.Items is null || body.Items.Count == 0) {
            return Results.Json(new { error = "No items." }, statusCode: 400);
        }
        if (body.Items.Count > 500) {
            return Results.Json(new { error = "Too many items (max 500 per call)." }, statusCode: 400);
        }

        var (orgId, _) = http.RequireOrgContext();
        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        // Per-item DataAnnotation validation — mirrors single Create so that
        // [Range(0, 24)] on Hours (and any future annotation) is enforced
        // on the AI/import path exactly as it is on the single-item path.
        var itemErrors = new Dictionary<string, string[]>();
        for (var i = 0; i < body.Items.Count; i++) {
            if (!MiniValidator.TryValidate(body.Items[i], out var errs)) {
                foreach (var kv in errs) {
                    itemErrors[$"items[{i}].{kv.Key}"] = kv.Value;
                }
            }
        }
        if (itemErrors.Count > 0) {
            return Results.ValidationProblem(itemErrors);
        }

        // Pre-validate every project + task ID belongs to the org so the
        // whole batch either lands or doesn't. Cheap join: one query for
        // the distinct project ids, one for tasks.
        //
        // Bulk endpoint never enqueues upstream pushes — AI distribute path
        // is async and the per-row push tracking gets messy at scale. Use
        // the single-item POST for pushes.
        if (body.Items.Any(x => x.ProjectId is null)) {
            return Results.Json(new { error = "Every bulk item needs a projectId." }, statusCode: 400);
        }
        var projectIds = body.Items.Select(x => x.ProjectId!.Value).Distinct().ToList();
        var validProjectCount = await db.NativeProjects
            .CountAsync(p => p.OrgId == orgId && projectIds.Contains(p.Id), ct);
        if (validProjectCount != projectIds.Count) {
            return Results.Json(new { error = "One or more projects not in this org." }, statusCode: 400);
        }

        var taskIds = body.Items.Where(x => x.TaskId is not null).Select(x => x.TaskId!.Value).Distinct().ToList();
        if (taskIds.Count > 0) {
            var validTaskCount = await db.NativeTasks
                .CountAsync(t => t.OrgId == orgId && taskIds.Contains(t.Id), ct);
            if (validTaskCount != taskIds.Count) {
                return Results.Json(new { error = "One or more tasks not in this org." }, statusCode: 400);
            }
        }

        var entities = body.Items.Select(item => new Worklog {
            OrgId = orgId,
            UserId = userId.Value,
            ProjectId = item.ProjectId,
            TaskId = item.TaskId,
            WorkDate = item.WorkDate,
            Hours = item.Hours,
            Notes = item.Notes,
            Source = string.IsNullOrWhiteSpace(item.Source) ? "ai" : item.Source.Trim().ToLowerInvariant(),
        }).ToList();
        db.Worklogs.AddRange(entities);
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:worklogs" }, ct);
        await audit.RecordAsync("worklog.bulk_created", orgId, userId, null, null,
            new { count = entities.Count, totalHours = entities.Sum(w => w.Hours) }, ct);

        return Results.Ok(new { count = entities.Count, ids = entities.Select(e => e.Id) });
    }

    // ---------------------------------------------------------------------
    // DELETE /api/orgs/{id}/worklogs/{worklogId}
    // ---------------------------------------------------------------------
    public static async Task<IResult> Delete(
        Guid id, Guid worklogId,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        var worklog = await db.Worklogs
            .FirstOrDefaultAsync(w => w.Id == worklogId && w.OrgId == orgId && w.UserId == userId.Value, ct);
        if (worklog is null) return Results.NotFound();

        if (worklog.InvoiceLineId is not null) {
            return Results.Conflict(new {
                error = "Worklog is on an invoice. Void the invoice before deleting.",
                code = "invoiced",
            });
        }

        db.Worklogs.Remove(worklog);
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:worklogs" }, ct);
        await audit.RecordAsync("worklog.deleted", orgId, userId, "worklog", worklog.Id.ToString(),
            new { projectId = worklog.ProjectId, date = worklog.WorkDate, hours = worklog.Hours }, ct);

        return Results.Ok(new { ok = true });
    }

    private static async Task<bool> ProjectBelongsToOrgAsync(
        TimeFlowDbContext db, Guid orgId, Guid projectId, Guid? taskId, CancellationToken ct) {
        var project = await db.NativeProjects.AnyAsync(p => p.Id == projectId && p.OrgId == orgId, ct);
        if (!project) return false;
        if (taskId is null) return true;
        return await db.NativeTasks.AnyAsync(t => t.Id == taskId && t.OrgId == orgId && t.ProjectId == projectId, ct);
    }
}
