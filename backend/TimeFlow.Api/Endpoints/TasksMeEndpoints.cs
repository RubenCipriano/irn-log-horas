using LinqKit;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Auth;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/tasks/me — list every cached upstream task assigned to
// the caller across ALL integration connections in the org. The natural
// match key is `(connectionId, assignee_upstream_id)` because every
// upstream identity is connection-local (OpenProject user id 14 in
// company A's instance is not user 14 in company B's). We learn the
// caller's upstream id from `IntegrationConnection.UpstreamUserId` set
// at verify time — i.e. you'll see your tasks from any connection YOU
// created (since the per-user RBAC model means you only see your own
// connections).
//
// Filters mirror /integrations/{connId}/synced: search, status, versionId,
// projectId; envelope is the same `{ total, items }`.
public static class TasksMeEndpoints {
    public static void MapTasksMeEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/tasks").RequireAuthorization();
        grp.MapGet("/me", ListMine).RequireOrgPermission(Permission.IntegrationsRead);
    }

    public static async Task<IResult> ListMine(
        Guid id,
        string? projectId, string? search, string? status, string? versionId,
        Guid? connectionId, int? skip, int? take,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        // Resolve the (connectionId, upstreamUserId) tuples visible to the
        // caller. Admin+ can pull from every connection in the org; everyone
        // else only from connections they created. This is the same shape
        // as the per-user filter on /integrations.
        var connsQ = db.IntegrationConnections.Where(c => c.OrgId == orgId);
        if (!role.AtLeast(OrgRole.Admin)) connsQ = connsQ.Where(c => c.CreatedBy == callerId);
        if (connectionId is Guid filterConnId) connsQ = connsQ.Where(c => c.Id == filterConnId);

        var tuples = await connsQ
            .Where(c => c.UpstreamUserId != null)
            .Select(c => new { ConnId = c.Id, UpstreamUserId = c.UpstreamUserId! })
            .ToListAsync(ct);

        if (tuples.Count == 0) return Results.Ok(new { total = 0, items = Array.Empty<IntegrationEndpoints.SyncedTaskItem>() });

        // Build an OR-of-ANDs predicate over the (connId, assigneeUpstreamId)
        // tuples the caller is allowed to see. The previous trick of
        // string-concatenating `"{guid}|{upstream}"` and doing IN(...) was
        // unsafe — an UpstreamUserId containing `|` would cross tuples and
        // leak rows from other connections. LinqKit's PredicateBuilder
        // composes a typed expression that EF translates to
        // `(conn_id=X AND assignee=Y) OR (conn_id=A AND assignee=B) ...`.
        // List size is tiny (one entry per visible connection, typically <20).
        // Phase C — same predicate shape but built against NativeTask,
        // which now carries (ConnectionId, AssigneeUpstreamId, UpstreamTaskId)
        // for mirrored rows. Native rows have ConnectionId == null and
        // never match the predicate, so they're excluded implicitly.
        var predicate = PredicateBuilder.New<NativeTask>(false);
        foreach (var t in tuples) {
            var connId = t.ConnId;
            var upstreamUserId = t.UpstreamUserId;
            predicate = predicate.Or(x =>
                x.ConnectionId == connId && x.AssigneeUpstreamId == upstreamUserId);
        }

        // Apply the OR predicate against NativeTask first (where LinqKit can
        // expand it cleanly) and THEN join to NativeProjects — invoking the
        // predicate over a composite anonymous projection trips LinqKit's
        // extension resolution. The join cost is unchanged.
        var taskQ = db.NativeTasks.AsNoTracking()
            .AsExpandable()
            .Where(t => t.OrgId == orgId && t.UpstreamTaskId != null)
            .Where(predicate);
        var q = from t in taskQ
                join p in db.NativeProjects.AsNoTracking() on t.ProjectId equals p.Id
                select new { t, p };

        if (!string.IsNullOrWhiteSpace(projectId)) q = q.Where(x => x.p.UpstreamProjectId == projectId);
        if (!string.IsNullOrWhiteSpace(status)) q = q.Where(x => x.t.Status == status);
        if (!string.IsNullOrWhiteSpace(versionId)) {
            if (versionId == "none") q = q.Where(x => x.t.UpstreamVersionId == null);
            else q = q.Where(x => x.t.UpstreamVersionId == versionId);
        }
        if (!string.IsNullOrWhiteSpace(search)) {
            var s = search.Trim().ToLower();
            q = q.Where(x => x.t.Title.ToLower().Contains(s) || x.t.UpstreamTaskId!.Contains(s));
        }

        var total = await q.CountAsync(ct);
        var page = await q
            .OrderByDescending(x => x.t.UpstreamUpdatedAt ?? x.t.UpdatedAt)
            .Skip(Math.Max(0, skip ?? 0))
            .Take(Math.Clamp(take ?? 100, 1, 500))
            .Select(x => new IntegrationEndpoints.SyncedTaskItem(
                x.t.Id,
                x.t.UpstreamTaskId!,
                x.p.UpstreamProjectId!,
                x.t.Title,
                x.t.Status,
                x.t.AssigneeUpstreamId,
                x.t.UpstreamUpdatedAt,
                x.t.UpdatedAt,
                x.t.UpstreamVersionId,
                x.t.UpstreamVersionName))
            .ToListAsync(ct);

        return Results.Ok(new { total, items = page });
    }
}
