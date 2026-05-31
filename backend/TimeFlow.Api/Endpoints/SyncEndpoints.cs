using Hangfire;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/integrations/{connId}/sync (POST) +
// /api/orgs/{id}/sync-jobs/* (GET + cancel) — trigger and observe the
// Hangfire-backed worker from Phase 8.
//
// Authz: org membership at the URL level (IntegrationsRead). Per-connection
// ownership gated inside the handler — Admin+ can act on any connection in
// the org, anyone else only their own. 404 (not 403) on non-owner reads.
public static class SyncEndpoints {
    public static void MapSyncEndpoints(this WebApplication app) {
        var enqueue = app.MapGroup("/api/orgs/{id:guid}/integrations/{connId:guid}").RequireAuthorization();
        enqueue.MapPost("/sync", Enqueue)
            .RequireOrgPermission(Permission.IntegrationsRead)
            .RequireRateLimiting(RateLimitPolicies.Expensive);

        var jobs = app.MapGroup("/api/orgs/{id:guid}/sync-jobs").RequireAuthorization();
        jobs.MapGet("", List).RequireOrgPermission(Permission.IntegrationsRead);
        jobs.MapGet("/{jobId:guid}", Get).RequireOrgPermission(Permission.IntegrationsRead);
        jobs.MapPost("/{jobId:guid}/cancel", Cancel).RequireOrgPermission(Permission.IntegrationsRead);
    }

    public sealed record SyncJobItem(
        Guid Id, Guid ConnectionId, string Kind, string Status,
        int ProgressTotal, int ProgressDone, bool CancelRequested,
        string? ErrorCode, string? ErrorMessage, string? Summary,
        DateTime? StartedAt, DateTime? FinishedAt, DateTime CreatedAt);

    private static SyncJobItem Project(IntegrationSyncJob j) => new(
        j.Id, j.ConnectionId, j.Kind, j.Status,
        j.ProgressTotal, j.ProgressDone, j.CancelRequested,
        j.ErrorCode, j.ErrorMessage, j.SummaryJson,
        j.StartedAt, j.FinishedAt, j.CreatedAt);

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/integrations/{connId}/sync?full=true
    // ---------------------------------------------------------------------
    public static async Task<IResult> Enqueue(
        Guid id, Guid connId, bool? full,
        TimeFlowDbContext db,
        IBackgroundJobClient hangfire,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var conn = await IntegrationEndpoints.LoadOwnedOrManagerAsync(connId, http, db, ct);
        if (conn is null) return Results.NotFound();

        // Refuse to stack: if there's already a queued/running job for
        // this connection, return it instead of creating a duplicate. The
        // UI can show "already running, here's the existing one."
        var existing = await db.IntegrationSyncJobs
            .Where(j => j.ConnectionId == connId
                && (j.Status == "queued" || j.Status == "running"))
            .OrderByDescending(j => j.CreatedAt)
            .FirstOrDefaultAsync(ct);
        if (existing is not null) {
            return Results.Ok(new { reused = true, job = Project(existing) });
        }

        var fullResync = full ?? false;
        var job = new IntegrationSyncJob {
            OrgId = orgId,
            ConnectionId = connId,
            Kind = fullResync ? "pull-full" : "pull",
            Status = "queued",
            StartedBy = callerId,
            FullResync = fullResync,
        };
        db.IntegrationSyncJobs.Add(job);
        await db.SaveChangesAsync(ct);

        // Enqueue AFTER the row exists so the worker can always find it.
        hangfire.Enqueue<WorklogSyncJob>(w => w.RunAsync(job.Id, JobCancellationToken.Null));

        await audit.RecordAsync("integration.sync_enqueued", orgId, callerId, "sync_job", job.Id.ToString(),
            new { connectionId = connId, full = fullResync }, ct);

        return Results.Ok(new { reused = false, job = Project(job) });
    }

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/sync-jobs?connectionId=...&limit=20
    // ---------------------------------------------------------------------
    public static async Task<IResult> List(
        Guid id, Guid? connectionId, int? limit,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        var take = Math.Clamp(limit ?? 20, 1, 100);

        var q = db.IntegrationSyncJobs.AsNoTracking().Where(j => j.OrgId == orgId);
        if (connectionId is not null) q = q.Where(j => j.ConnectionId == connectionId.Value);
        // Non-admins only see jobs for connections they own. We restrict by
        // EXISTS over IntegrationConnections instead of joining so the
        // existing Project shape stays untouched.
        if (!role.AtLeast(OrgRole.Admin)) {
            q = q.Where(j => db.IntegrationConnections
                .Any(c => c.Id == j.ConnectionId && c.CreatedBy == callerId));
        }

        var jobs = await q.OrderByDescending(j => j.CreatedAt)
            .Take(take)
            .ToListAsync(ct);

        return Results.Ok(jobs.Select(Project));
    }

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/sync-jobs/{jobId} — the UI polls this
    // ---------------------------------------------------------------------
    public static async Task<IResult> Get(
        Guid id, Guid jobId,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var job = await db.IntegrationSyncJobs.AsNoTracking()
            .FirstOrDefaultAsync(j => j.Id == jobId && j.OrgId == orgId, ct);
        if (job is null) return Results.NotFound();
        var conn = await IntegrationEndpoints.LoadOwnedOrManagerAsync(job.ConnectionId, http, db, ct);
        if (conn is null) return Results.NotFound();
        return Results.Ok(Project(job));
    }

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/sync-jobs/{jobId}/cancel
    // ---------------------------------------------------------------------
    public static async Task<IResult> Cancel(
        Guid id, Guid jobId,
        TimeFlowDbContext db,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var job = await db.IntegrationSyncJobs.FirstOrDefaultAsync(j => j.Id == jobId && j.OrgId == orgId, ct);
        if (job is null) return Results.NotFound();
        var conn = await IntegrationEndpoints.LoadOwnedOrManagerAsync(job.ConnectionId, http, db, ct);
        if (conn is null) return Results.NotFound();

        if (job.Status == "succeeded" || job.Status == "failed" || job.Status == "cancelled") {
            return Results.Ok(new { ok = true, alreadyTerminal = true, status = job.Status });
        }

        job.CancelRequested = true;
        await db.SaveChangesAsync(ct);
        await audit.RecordAsync("integration.sync_cancel_requested", orgId, callerId, "sync_job", job.Id.ToString(), null, ct);

        return Results.Ok(new { ok = true, status = "cancelling" });
    }
}
