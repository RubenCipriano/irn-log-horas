using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Integrations;
using TimeFlow.Integrations.Contract;
using TimeFlow.Rbac;
using TimeFlow.Vault;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/tasks — Manager+ org-wide tasks browse with full CRUD.
// Phase C — both "native" (TimeFlow PM) and "upstream" (mirrored from
// OpenProject etc.) tasks live in the same `native_tasks` table now. The
// discriminator is computed from `ConnectionId` + `UpstreamTaskId`:
//   * native   → ConnectionId IS NULL  (locally-created task)
//   * upstream → ConnectionId IS NOT NULL AND UpstreamTaskId IS NOT NULL
//                (mirror row maintained by WorklogSyncJob.UpsertProjectAsync)
//
// Per-row writes route on `kind`:
//   * native   → write the local row directly
//   * upstream → push to the adapter (`CreateTaskAsync`/`UpdateTaskAsync`)
//                AND mirror the change into the corresponding mirror row
//                so the next read reflects it without a full re-sync
//
// Upstream DELETE is deliberately 405 — destructive deletes on OpenProject
// work packages are rare and best done in the upstream UI; we don't want
// a misclick here to obliterate someone's tracker history.
public static class TasksAllEndpoints {
    public static void MapTasksAllEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/tasks").RequireAuthorization();
        grp.MapGet("", List).RequireOrgPermission(Permission.TasksReadOrg);
        grp.MapPost("", Create).RequireOrgPermission(Permission.TasksWriteOrg);
        grp.MapPatch("/{taskId}", Update).RequireOrgPermission(Permission.TasksWriteOrg);
        grp.MapDelete("/{taskId:guid}", Delete).RequireOrgPermission(Permission.TasksWriteOrg);
    }

    // Unified shape: discriminator + the union of native + upstream fields.
    // Frontend dispatches on `kind` for icons + action menus. The Id format
    // is preserved across the Phase C cut so the frontend keeps parsing it
    // without changes: bare Guid for native, "{connId:N}:{taskId:N}" for
    // upstream — even though both Ids now come from the same `native_tasks`
    // table.
    public sealed record UnifiedTaskItem(
        string Kind, // "native" | "upstream"
        string Id,
        Guid? NativeProjectId,
        Guid? ConnectionId,
        string? UpstreamProjectId,
        string? UpstreamId,
        string Title,
        string? Description,
        string Status,
        Guid? NativeAssigneeId,
        string? AssigneeUpstreamId,
        string? UpstreamVersionId,
        string? UpstreamVersionName,
        DateTime UpdatedAt);

    // -------------------------------------------------------------------
    // GET /api/orgs/{id}/tasks — server-paginated cross-source list
    // -------------------------------------------------------------------
    public static async Task<IResult> List(
        Guid id,
        string? search, string? status, string? versionId,
        Guid? nativeProjectId, Guid? connectionId, string? upstreamProjectId,
        int? skip, int? take,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();

        // One query against native_tasks + native_projects. The "upstream
        // vs native" discriminator is `t.UpstreamTaskId IS NULL` on the row.
        var baseQ = from t in db.NativeTasks.AsNoTracking()
                    join p in db.NativeProjects.AsNoTracking() on t.ProjectId equals p.Id
                    where t.OrgId == orgId
                    select new { t, p };

        if (nativeProjectId is Guid np) baseQ = baseQ.Where(x => x.t.ProjectId == np);
        if (connectionId is Guid cid) baseQ = baseQ.Where(x => x.t.ConnectionId == cid);
        if (!string.IsNullOrWhiteSpace(upstreamProjectId)) {
            baseQ = baseQ.Where(x => x.p.UpstreamProjectId == upstreamProjectId);
        }
        if (!string.IsNullOrWhiteSpace(status)) baseQ = baseQ.Where(x => x.t.Status == status);
        if (!string.IsNullOrWhiteSpace(versionId)) {
            if (versionId == "none") baseQ = baseQ.Where(x => x.t.UpstreamVersionId == null);
            else baseQ = baseQ.Where(x => x.t.UpstreamVersionId == versionId);
        }
        if (!string.IsNullOrWhiteSpace(search)) {
            var s = search.Trim().ToLower();
            baseQ = baseQ.Where(x => x.t.Title.ToLower().Contains(s)
                || (x.t.UpstreamTaskId != null && x.t.UpstreamTaskId.Contains(s)));
        }

        var total = await baseQ.CountAsync(ct);
        var pageSize = Math.Clamp(take ?? 100, 1, 500);
        var pageSkip = Math.Max(0, skip ?? 0);

        var rows = await baseQ
            .OrderByDescending(x => x.t.UpstreamUpdatedAt ?? x.t.UpdatedAt)
            .Skip(pageSkip).Take(pageSize)
            .ToListAsync(ct);

        var items = rows.Select(x => Project(x.t, x.p)).ToList();
        return Results.Ok(new { total, items });
    }

    // -------------------------------------------------------------------
    // POST /api/orgs/{id}/tasks — create native OR push upstream
    // -------------------------------------------------------------------
    public sealed record CreateTaskRequest(
        [Required] string Kind, // "native" | "upstream"
        Guid? NativeProjectId,
        Guid? ConnectionId,
        string? UpstreamProjectId,
        [Required, MinLength(2), MaxLength(200)] string Title,
        string? Description,
        string? Status,
        Guid? NativeAssigneeId,
        string? AssigneeUpstreamId,
        string? UpstreamVersionId);

    public static async Task<IResult> Create(
        Guid id,
        CreateTaskRequest body,
        TimeFlowDbContext db,
        IIntegrationRegistry registry,
        IVaultService vault,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        if (body.Kind == "native") {
            if (body.NativeProjectId is not Guid np) {
                return Results.Json(new { error = "nativeProjectId required for kind=native." }, statusCode: 400);
            }
            var project = await db.NativeProjects.FirstOrDefaultAsync(p => p.Id == np && p.OrgId == orgId, ct);
            if (project is null) return Results.NotFound();

            var task = new NativeTask {
                ProjectId = np,
                OrgId = orgId,
                Title = body.Title.Trim(),
                Description = body.Description,
                Status = string.IsNullOrWhiteSpace(body.Status) ? "open" : body.Status.Trim().ToLowerInvariant(),
                AssigneeId = body.NativeAssigneeId,
                CreatedBy = callerId,
            };
            db.NativeTasks.Add(task);
            await db.SaveChangesAsync(ct);
            await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:tasks" }, ct);
            await audit.RecordAsync("task.created", orgId, callerId, "task", task.Id.ToString(),
                new { title = task.Title, projectId = np, status = task.Status }, ct);
            return Results.Ok(Project(task, project));
        }

        if (body.Kind == "upstream") {
            if (body.ConnectionId is not Guid cid) {
                return Results.Json(new { error = "connectionId required for kind=upstream." }, statusCode: 400);
            }
            if (string.IsNullOrWhiteSpace(body.UpstreamProjectId)) {
                return Results.Json(new { error = "upstreamProjectId required for kind=upstream." }, statusCode: 400);
            }
            var conn = await IntegrationEndpoints.LoadOwnedOrManagerAsync(cid, http, db, ct);
            if (conn is null) return Results.NotFound();

            // The mirror project must already exist (sync creates it). The
            // (connection_id, upstream_project_id) tuple is the natural key.
            var mirrorProject = await db.NativeProjects.FirstOrDefaultAsync(
                p => p.ConnectionId == cid && p.UpstreamProjectId == body.UpstreamProjectId, ct);
            if (mirrorProject is null) {
                return Results.Json(new { error = "Mirror project not found — run a sync first." }, statusCode: 404);
            }

            var creds = DecryptCredentials(conn, vault, registry);
            var adapter = registry.Get(conn.Provider);
            IntegrationTask created;
            try {
                created = await adapter.CreateTaskAsync(creds, body.UpstreamProjectId!, new IntegrationTaskCreateInput(
                    Title: body.Title.Trim(),
                    Status: body.Status,
                    AssigneeId: body.AssigneeUpstreamId,
                    VersionId: body.UpstreamVersionId,
                    Description: body.Description), ct);
            } catch (NotSupportedException) {
                return Results.Json(new { error = "Provider does not support task creation." }, statusCode: 501);
            } catch (UpstreamIntegrationException ex) {
                return Results.Json(new { error = ex.Message, code = ex.Class.ToString().ToLower() }, statusCode: 502);
            }

            // Mirror into native_tasks so the list reflects the new row
            // without waiting for the next sync. Truncate to column width to
            // match Phase B backfill policy + sync job behaviour.
            var row = new NativeTask {
                ProjectId = mirrorProject.Id,
                OrgId = orgId,
                ConnectionId = cid,
                UpstreamTaskId = created.Id,
                Title = created.Title.Length > 200 ? created.Title[..200] : created.Title,
                Status = string.IsNullOrWhiteSpace(created.Status) ? "open" : created.Status,
                AssigneeUpstreamId = created.AssigneeId,
                UpstreamUpdatedAt = created.UpdatedAt,
                UpstreamVersionId = created.VersionId,
                UpstreamVersionName = created.VersionName,
                UpstreamRawJson = created.Raw,
                CreatedBy = callerId,
            };
            db.NativeTasks.Add(row);
            await db.SaveChangesAsync(ct);
            await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:tasks" }, ct);
            await audit.RecordAsync("integration.task_created", orgId, callerId, "upstream_task", row.Id.ToString(),
                new { connectionId = cid, upstreamId = created.Id, title = created.Title }, ct);

            return Results.Ok(Project(row, mirrorProject));
        }

        return Results.Json(new { error = "kind must be 'native' or 'upstream'." }, statusCode: 400);
    }

    // -------------------------------------------------------------------
    // PATCH /api/orgs/{id}/tasks/{taskId}
    // -------------------------------------------------------------------
    public sealed record UpdateTaskRequest(
        string? Title,
        string? Description,
        string? Status,
        bool SetNativeAssignee,
        Guid? NativeAssigneeId,
        string? AssigneeUpstreamId,
        string? UpstreamVersionId);

    public static async Task<IResult> Update(
        Guid id, string taskId,
        UpdateTaskRequest body,
        TimeFlowDbContext db,
        IIntegrationRegistry registry,
        IVaultService vault,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        // Reject anything that can't be a sensible task id before parsing.
        // Native ids are 36-char Guids; upstream are "{guid:N}:{guid:N}" =
        // 32 + 1 + 32 = 65. Anything over ~80 chars is junk / probe payload.
        if (string.IsNullOrEmpty(taskId) || taskId.Length > 80) {
            return Results.Json(new { error = "Bad task id." }, statusCode: 400);
        }

        // Unified id format: bare Guid for native, "{connId:N}:{rowGuid:N}" for upstream.
        if (taskId.Contains(':')) {
            return await UpdateUpstreamAsync(orgId, taskId, body, db, registry, vault, cache, audit, http, callerId, ct);
        }
        if (!Guid.TryParse(taskId, out var nativeTaskId)) {
            return Results.Json(new { error = "Bad task id." }, statusCode: 400);
        }
        return await UpdateNativeAsync(orgId, nativeTaskId, body, db, cache, audit, callerId, ct);
    }

    private static async Task<IResult> UpdateNativeAsync(
        Guid orgId, Guid taskId, UpdateTaskRequest body,
        TimeFlowDbContext db, ICacheStore cache, IAuditLogger audit, Guid? callerId, CancellationToken ct) {
        // Native-only path: the row must NOT carry upstream metadata.
        // Mirror rows go through the upstream path so the adapter call
        // happens before the DB mutation.
        var task = await db.NativeTasks.FirstOrDefaultAsync(
            t => t.Id == taskId && t.OrgId == orgId && t.ConnectionId == null, ct);
        if (task is null) return Results.NotFound();
        var project = await db.NativeProjects.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == task.ProjectId, ct);
        if (project is null) return Results.NotFound();

        if (!string.IsNullOrWhiteSpace(body.Title)) task.Title = body.Title.Trim();
        if (body.Description is not null) task.Description = body.Description;
        if (!string.IsNullOrWhiteSpace(body.Status)) task.Status = body.Status.Trim().ToLowerInvariant();
        if (body.SetNativeAssignee) task.AssigneeId = body.NativeAssigneeId;
        task.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:tasks" }, ct);
        await audit.RecordAsync("task.updated", orgId, callerId, "task", task.Id.ToString(),
            new { title = task.Title, status = task.Status }, ct);
        return Results.Ok(Project(task, project));
    }

    private static async Task<IResult> UpdateUpstreamAsync(
        Guid orgId, string compositeId, UpdateTaskRequest body,
        TimeFlowDbContext db, IIntegrationRegistry registry, IVaultService vault,
        ICacheStore cache, IAuditLogger audit, HttpContext http, Guid? callerId, CancellationToken ct) {
        var parts = compositeId.Split(':');
        if (parts.Length != 2 || !Guid.TryParse(parts[0], out var connId) || !Guid.TryParse(parts[1], out var rowId)) {
            return Results.Json(new { error = "Bad upstream task id." }, statusCode: 400);
        }
        var conn = await IntegrationEndpoints.LoadOwnedOrManagerAsync(connId, http, db, ct);
        if (conn is null) return Results.NotFound();

        var row = await db.NativeTasks.FirstOrDefaultAsync(
            t => t.Id == rowId && t.ConnectionId == connId && t.OrgId == orgId
              && t.UpstreamTaskId != null, ct);
        if (row is null) return Results.NotFound();
        var project = await db.NativeProjects.AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == row.ProjectId, ct);
        if (project is null) return Results.NotFound();

        var creds = DecryptCredentials(conn, vault, registry);
        var adapter = registry.Get(conn.Provider);
        IntegrationTask updated;
        try {
            updated = await adapter.UpdateTaskAsync(creds, row.UpstreamTaskId!, new IntegrationTaskUpdateInput(
                Title: body.Title,
                Status: body.Status,
                AssigneeId: body.AssigneeUpstreamId,
                VersionId: body.UpstreamVersionId,
                Description: body.Description), ct);
        } catch (NotSupportedException) {
            return Results.Json(new { error = "Provider does not support task updates." }, statusCode: 501);
        } catch (UpstreamIntegrationException ex) {
            return Results.Json(new { error = ex.Message, code = ex.Class.ToString().ToLower() }, statusCode: 502);
        }

        row.Title = updated.Title.Length > 200 ? updated.Title[..200] : updated.Title;
        row.Status = string.IsNullOrWhiteSpace(updated.Status) ? row.Status : updated.Status;
        row.AssigneeUpstreamId = updated.AssigneeId;
        row.UpstreamUpdatedAt = updated.UpdatedAt;
        row.UpstreamVersionId = updated.VersionId;
        row.UpstreamVersionName = updated.VersionName;
        row.UpstreamRawJson = updated.Raw;
        row.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:tasks" }, ct);
        await audit.RecordAsync("integration.task_updated", orgId, callerId, "upstream_task", row.Id.ToString(),
            new { connectionId = connId, upstreamId = row.UpstreamTaskId, title = row.Title }, ct);

        return Results.Ok(Project(row, project));
    }

    // -------------------------------------------------------------------
    // DELETE /api/orgs/{id}/tasks/{taskId} — native only.
    // -------------------------------------------------------------------
    public static async Task<IResult> Delete(
        Guid id, Guid taskId,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        // Native-only: mirror rows are managed by the sync job and must not
        // be hard-deleted from here (the next sync would just re-create them).
        var task = await db.NativeTasks.FirstOrDefaultAsync(
            t => t.Id == taskId && t.OrgId == orgId && t.ConnectionId == null, ct);
        if (task is null) return Results.NotFound();
        db.NativeTasks.Remove(task);
        await db.SaveChangesAsync(ct);
        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:tasks" }, ct);
        await audit.RecordAsync("task.deleted", orgId, callerId, "task", task.Id.ToString(),
            new { title = task.Title }, ct);
        return Results.Ok(new { ok = true });
    }

    // -------------------------------------------------------------------
    // Projection: discriminate on `ConnectionId + UpstreamTaskId`. Both
    // kinds share the `native_tasks` table now; the discriminator is the
    // mirror tuple's presence.
    private static UnifiedTaskItem Project(NativeTask t, NativeProject p) {
        var isUpstream = t.ConnectionId is Guid && t.UpstreamTaskId != null;
        return new UnifiedTaskItem(
            Kind: isUpstream ? "upstream" : "native",
            Id: isUpstream ? $"{t.ConnectionId:N}:{t.Id:N}" : t.Id.ToString(),
            NativeProjectId: isUpstream ? null : t.ProjectId,
            ConnectionId: isUpstream ? t.ConnectionId : null,
            UpstreamProjectId: isUpstream ? p.UpstreamProjectId : null,
            UpstreamId: isUpstream ? t.UpstreamTaskId : null,
            Title: t.Title,
            Description: isUpstream ? null : t.Description,
            Status: t.Status,
            NativeAssigneeId: isUpstream ? null : t.AssigneeId,
            AssigneeUpstreamId: isUpstream ? t.AssigneeUpstreamId : null,
            UpstreamVersionId: isUpstream ? t.UpstreamVersionId : null,
            UpstreamVersionName: isUpstream ? t.UpstreamVersionName : null,
            UpdatedAt: t.UpstreamUpdatedAt ?? t.UpdatedAt);
    }

    private static IntegrationCredentials DecryptCredentials(
        IntegrationConnection conn, IVaultService vault, IIntegrationRegistry registry) {
        var json = vault.Decrypt(conn.EncryptedCredentials, $"integration:{conn.Id:N}");
        return registry.DecodeCredentials(conn.Provider, json);
    }
}
