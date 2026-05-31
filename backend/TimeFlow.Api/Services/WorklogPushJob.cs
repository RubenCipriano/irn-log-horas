using System.Diagnostics;
using Hangfire;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Integrations;
using TimeFlow.Integrations.Contract;
using TimeFlow.Vault;

namespace TimeFlow.Api.Services;

// Hangfire-invokable worker that pushes a single Worklog row to its
// upstream tracker. Enqueued by WorklogEndpoints.Create when the worklog's
// task carries a mirror tuple `(ConnectionId, UpstreamTaskId)` on the
// NativeTask row. The user's request returns immediately with
// `pushStatus="pending"` and this job flips it to `pushed` or `failed`
// after the upstream call completes.
//
// Phase C — the mirror tuple moved off `worklog.upstream_task_id` and
// onto `native_tasks.connection_id + native_tasks.upstream_task_id`. The
// worklog still carries `TaskId`; we read the tuple from the task row.
//
// Retry policy: relies on Hangfire's default exponential backoff for
// network/server-class errors. Auth errors get marked `failed` and
// NOT retried (no point — the credential won't fix itself).
public sealed class WorklogPushJob {
    private readonly TimeFlowDbContext _db;
    private readonly IIntegrationRegistry _registry;
    private readonly IVaultService _vault;
    private readonly IAuditLogger _audit;
    private readonly ICacheStore _cache;
    private readonly ILogger<WorklogPushJob> _log;

    public WorklogPushJob(
        TimeFlowDbContext db,
        IIntegrationRegistry registry,
        IVaultService vault,
        IAuditLogger audit,
        ICacheStore cache,
        ILogger<WorklogPushJob> log) {
        _db = db;
        _registry = registry;
        _vault = vault;
        _audit = audit;
        _cache = cache;
        _log = log;
    }

    [AutomaticRetry(Attempts = 5, OnAttemptsExceeded = AttemptsExceededAction.Fail)]
    public async Task PushAsync(Guid worklogId) {
        var sw = Stopwatch.StartNew();
        var worklog = await _db.Worklogs.FirstOrDefaultAsync(w => w.Id == worklogId);
        if (worklog is null) {
            _log.LogWarning("WorklogPushJob: worklog {WorklogId} not found", worklogId);
            return;
        }

        // Skip if already terminal — Hangfire can re-enqueue on process
        // restart; idempotency guard avoids a double push.
        if (worklog.PushStatus == "pushed") return;
        if (worklog.TaskId is null) {
            _log.LogWarning("WorklogPushJob: worklog {WorklogId} has no TaskId", worklogId);
            return;
        }

        // Mirror tuple now lives on the NativeTask. ConnectionId+UpstreamTaskId
        // both being non-null is the discriminator for "this task pushes
        // upstream" (vs locally-created).
        var task = await _db.NativeTasks
            .FirstOrDefaultAsync(t => t.Id == worklog.TaskId.Value);
        if (task is null) {
            await MarkFailedAsync(worklog, "generic", "Task was deleted before push.");
            return;
        }
        if (task.ConnectionId is not Guid connectionId || task.UpstreamTaskId is null) {
            _log.LogWarning("WorklogPushJob: worklog {WorklogId} task is not a mirror row", worklogId);
            return;
        }

        var conn = await _db.IntegrationConnections
            .FirstOrDefaultAsync(c => c.Id == connectionId);
        if (conn is null) {
            await MarkFailedAsync(worklog, "generic", "Integration connection was deleted before push.");
            return;
        }

        IntegrationCredentials creds;
        try {
            var json = _vault.Decrypt(conn.EncryptedCredentials, $"integration:{conn.Id:N}");
            creds = _registry.DecodeCredentials(conn.Provider, json);
        } catch (Exception ex) {
            _log.LogError(ex, "WorklogPushJob: decrypt failed for connection {ConnectionId}", conn.Id);
            await MarkFailedAsync(worklog, "generic", "Could not decrypt stored credential.");
            return;
        }

        var adapter = _registry.Get(conn.Provider);
        try {
            var result = await adapter.PostWorklogAsync(
                creds,
                task.UpstreamTaskId!,
                worklog.Hours,
                worklog.WorkDate,
                worklog.Notes);

            // Refresh from DB so concurrent edits don't get clobbered.
            _db.ChangeTracker.Clear();
            var fresh = await _db.Worklogs.FirstAsync(w => w.Id == worklogId);
            fresh.PushStatus = "pushed";
            fresh.UpstreamWorklogId = result.UpstreamId;
            fresh.PushErrorCode = null;
            fresh.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            // The push flipped pushStatus on a row the calendar reads via
            // cache-aside — drop the worklogs tag so the badge updates
            // without waiting out the TTL.
            await InvalidateWorklogsCacheAsync(worklog.OrgId);

            await _audit.RecordAsync("worklog.pushed", worklog.OrgId, worklog.UserId,
                "worklog", worklog.Id.ToString(),
                new { upstreamWorklogId = result.UpstreamId, durationMs = sw.ElapsedMilliseconds });
        } catch (UpstreamIntegrationException ex) {
            // Auth errors won't fix themselves — mark failed, no retry.
            if (ex.Class == UpstreamErrorClass.Auth) {
                await MarkFailedAsync(worklog, "auth", ex.Message);
                return;
            }
            // Network / server — let Hangfire retry by throwing.
            await MarkPendingRetryAsync(worklog, ex.Class.ToString().ToLowerInvariant());
            throw;
        } catch (Exception ex) {
            _log.LogError(ex, "WorklogPushJob: unexpected error pushing worklog {WorklogId}", worklogId);
            await MarkFailedAsync(worklog, "generic", "Unexpected push error.");
            // Don't rethrow generic — we've marked failed terminally.
        }
    }

    private async Task MarkFailedAsync(Data.Models.Worklog worklog, string errorCode, string message) {
        _db.ChangeTracker.Clear();
        var fresh = await _db.Worklogs.FirstOrDefaultAsync(w => w.Id == worklog.Id);
        if (fresh is null) return;
        fresh.PushStatus = "failed";
        fresh.PushErrorCode = errorCode;
        fresh.UpdatedAt = DateTime.UtcNow;
        var written = false;
        try {
            await _db.SaveChangesAsync();
            written = true;
        } catch (Exception ex) {
            // Best-effort: the row stays "pending" and a later attempt/retry
            // re-flips it. Log so a stuck status is observable instead of
            // silently swallowed. `message` is already a bucketed, redacted
            // string — no credential material.
            _log.LogError(ex, "WorklogPushJob: failed to persist failed-status for worklog {WorklogId} ({ErrorCode})", worklog.Id, errorCode);
        }
        if (written) await InvalidateWorklogsCacheAsync(worklog.OrgId);
        await _audit.RecordAsync("worklog.push_failed", worklog.OrgId, worklog.UserId,
            "worklog", worklog.Id.ToString(), new { errorCode, message });
    }

    private async Task MarkPendingRetryAsync(Data.Models.Worklog worklog, string errorCode) {
        // Keep status="pending" so the UI keeps showing the spinner while
        // Hangfire backs off and retries. Just record the last error class.
        _db.ChangeTracker.Clear();
        var fresh = await _db.Worklogs.FirstOrDefaultAsync(w => w.Id == worklog.Id);
        if (fresh is null) return;
        fresh.PushErrorCode = errorCode;
        fresh.UpdatedAt = DateTime.UtcNow;
        var written = false;
        try {
            await _db.SaveChangesAsync();
            written = true;
        } catch (Exception ex) {
            _log.LogError(ex, "WorklogPushJob: failed to persist retry error-code for worklog {WorklogId} ({ErrorCode})", worklog.Id, errorCode);
        }
        if (written) await InvalidateWorklogsCacheAsync(worklog.OrgId);
    }

    private async Task InvalidateWorklogsCacheAsync(Guid orgId) {
        try {
            await _cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:worklogs" });
        } catch (Exception ex) {
            // Recoverable — the entry TTLs out anyway; never crash the push
            // (or its Hangfire retry bookkeeping) over a cache miss.
            _log.LogError(ex, "WorklogPushJob: cache invalidation failed for org {OrgId}", orgId);
        }
    }
}
