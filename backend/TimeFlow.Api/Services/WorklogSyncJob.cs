using System.Diagnostics;
using System.Text.Json;
using Hangfire;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Integrations;
using TimeFlow.Integrations.Contract;
using TimeFlow.Vault;

namespace TimeFlow.Api.Services;

// The thing Hangfire actually runs. One method (`RunAsync`) so the
// enqueuer can stay simple. Hangfire serialises the args (Guids only)
// and re-instantiates this class via DI for each execution — so we get
// a fresh DbContext, fresh HttpClient, no cross-request state leaks.
//
// Cooperative cancellation: every page boundary we re-read the job row
// and bail if `cancel_requested = true`. Hangfire's own cancellation
// (process shutdown) bubbles through `IJobCancellationToken`.
public sealed class WorklogSyncJob {
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly TimeFlowDbContext _db;
    private readonly IIntegrationRegistry _registry;
    private readonly IVaultService _vault;
    private readonly ICacheStore _cache;
    private readonly ILogger<WorklogSyncJob> _log;

    public WorklogSyncJob(
        TimeFlowDbContext db,
        IIntegrationRegistry registry,
        IVaultService vault,
        ICacheStore cache,
        ILogger<WorklogSyncJob> log) {
        _db = db;
        _registry = registry;
        _vault = vault;
        _cache = cache;
        _log = log;
    }

    // Hangfire calls this. Args MUST be primitive/serialisable.
    public async Task RunAsync(Guid syncJobId, IJobCancellationToken hangfireCt) {
        var sw = Stopwatch.StartNew();
        var job = await _db.IntegrationSyncJobs.FirstOrDefaultAsync(j => j.Id == syncJobId);
        if (job is null) {
            _log.LogWarning("WorklogSyncJob: job {SyncJobId} not found (cancelled before run?)", syncJobId);
            return;
        }

        // If the user cancelled before we even started, honour it.
        if (job.CancelRequested) {
            await MarkTerminalAsync(job, "cancelled", null, null, projectsSynced: 0, tasksUpserted: 0, sw);
            return;
        }

        job.Status = "running";
        job.StartedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        var conn = await _db.IntegrationConnections.FirstOrDefaultAsync(c => c.Id == job.ConnectionId);
        if (conn is null) {
            await MarkTerminalAsync(job, "failed", "generic", "Connection no longer exists.", 0, 0, sw);
            return;
        }

        IntegrationCredentials creds;
        try {
            var json = _vault.Decrypt(conn.EncryptedCredentials, $"integration:{conn.Id:N}");
            creds = _registry.DecodeCredentials(conn.Provider, json);
        } catch (Exception ex) {
            _log.LogError(ex, "WorklogSyncJob: failed to decrypt credential for connection {ConnectionId}", conn.Id);
            await MarkTerminalAsync(job, "failed", "generic", "Could not decrypt stored credential.", 0, 0, sw);
            return;
        }

        var adapter = _registry.Get(conn.Provider);
        var projectsSynced = 0;
        var tasksUpserted = 0;
        var tasksSkippedUnchanged = 0;
        var doneCounter = 0;

        try {
            // First pass: list projects so we know the total. The adapter
            // pages internally; we cap at 200 here — orgs with >200 active
            // projects are vanishingly rare, and the cap stops a hostile
            // upstream from running us forever.
            var projects = new List<IntegrationProject>();
            await foreach (var p in adapter.ListProjectsAsync(creds, maxItems: 200, ct: hangfireCt.ShutdownToken)) {
                if (await IsCancelledAsync(job.Id, hangfireCt)) {
                    await MarkTerminalAsync(job, "cancelled", null, null, projectsSynced, tasksUpserted, sw);
                    return;
                }
                projects.Add(p);
            }
            job.ProgressTotal = projects.Count; // will be revised once we know per-project task counts
            await _db.SaveChangesAsync();

            // Watermark = newest `upstream_updated_at` we've ever cached for
            // this connection. Re-syncs hand this to the adapter so the
            // upstream only sends tasks that changed since. Null on the
            // first sync ever for a connection → full pull (correct).
            // Explicit `FullResync` requests bypass the watermark entirely
            // — that's how the user backfills new columns (e.g. sprints)
            // for tasks whose upstream timestamps haven't moved.
            DateTime? since = null;
            if (!job.FullResync) {
                // Phase C — watermark now read from the new mirror columns
                // on native_tasks (`connection_id`, `upstream_updated_at`).
                since = await _db.NativeTasks
                    .Where(t => t.ConnectionId == conn.Id && t.UpstreamTaskId != null)
                    .MaxAsync(t => (DateTime?)t.UpstreamUpdatedAt);
            }

            // Pre-load every existing mirrored task for this connection in
            // ONE query, keyed by upstream natural id. The unique partial
            // index `ix_native_tasks_connection_upstream_unique` enforces
            // (connection_id, upstream_task_id) uniqueness across the
            // whole connection — same shape the old upstream_tasks index
            // had — so the upsert cache keys cleanly.
            var existing = await _db.NativeTasks
                .Where(u => u.ConnectionId == conn.Id && u.UpstreamTaskId != null)
                .ToDictionaryAsync(u => u.UpstreamTaskId!);
            var initialCacheCount = existing.Count;
            var existingRowsUpdated = 0;

            foreach (var project in projects) {
                if (await IsCancelledAsync(job.Id, hangfireCt)) {
                    await MarkTerminalAsync(job, "cancelled", null, null, projectsSynced, tasksUpserted, sw, tasksSkippedUnchanged: Math.Max(0, initialCacheCount - existingRowsUpdated));
                    await InvalidateMirroredCachesAsync(conn.OrgId, CancellationToken.None);
                    return;
                }

                // Upsert the project metadata BEFORE iterating tasks so the
                // unified /projects view has names to display even mid-sync.
                // Returns the native row so we don't re-query it below — the
                // upsert already has it tracked (saves one round-trip per
                // project, ~200 on a full sync).
                var parentProject = await UpsertProjectAsync(conn, project);

                var sinceLastFlush = 0;

                // Pull only tasks assigned to the connection's upstream user.
                // Per-user connections (the standard install) log time only
                // against the user's own assignments, so cutting the long
                // tail of other people's tasks from the mirror saves a 10×+
                // sync — production runs were touching ~30k tasks where the
                // user logs against a few hundred.
                // Edge case: when the user logs time against a task NOT
                // assigned to them (e.g. helping on someone else's bug),
                // the worklog import returns SkippedNoTask. The summary
                // surfaces that count so it's visible.
                await foreach (var t in adapter.ListTasksAsync(creds, project.Id, maxItems: 5000, since: since, assigneeUpstreamId: conn.UpstreamUserId, ct: hangfireCt.ShutdownToken)) {
                    if (existing.TryGetValue(t.Id, out var row)) {
                        // Native_tasks.title is varchar(200); upstream
                        // titles run wider — same truncation policy as the
                        // Phase B backfill (silent LEFT() trim).
                        row.Title = t.Title.Length > 200 ? t.Title[..200] : t.Title;
                        row.Status = t.Status.Length > 40 ? t.Status[..40] : t.Status;
                        row.AssigneeUpstreamId = t.AssigneeId;
                        // Track project moves: same upstream_task_id, new
                        // parent_project. Re-lookup the parent if the
                        // upstream project id changed.
                        if (!string.Equals(row.UpstreamTaskId, t.Id, StringComparison.Ordinal)) {
                            row.UpstreamTaskId = t.Id;
                        }
                        row.ProjectId = parentProject.Id;
                        row.UpstreamUpdatedAt = t.UpdatedAt;
                        row.UpstreamVersionId = t.VersionId;
                        row.UpstreamVersionName = t.VersionName;
                        row.UpstreamRawJson = t.Raw;
                        row.UpdatedAt = DateTime.UtcNow;
                        existingRowsUpdated++;
                    } else {
                        var added = new NativeTask {
                            ProjectId = parentProject.Id,
                            OrgId = conn.OrgId,
                            ConnectionId = conn.Id,
                            UpstreamTaskId = t.Id,
                            Title = t.Title.Length > 200 ? t.Title[..200] : t.Title,
                            Status = string.IsNullOrWhiteSpace(t.Status)
                                ? "open"
                                : (t.Status.Length > 40 ? t.Status[..40] : t.Status),
                            AssigneeUpstreamId = t.AssigneeId,
                            UpstreamUpdatedAt = t.UpdatedAt,
                            UpstreamVersionId = t.VersionId,
                            UpstreamVersionName = t.VersionName,
                            UpstreamRawJson = t.Raw,
                        };
                        _db.NativeTasks.Add(added);
                        existing[t.Id] = added;
                    }
                    tasksUpserted++;
                    sinceLastFlush++;

                    // Flush + cancel-check at chunk boundary. 200 rows per
                    // commit keeps each SaveChanges fast while still
                    // amortising the per-call overhead across many writes.
                    if (sinceLastFlush >= 200) {
                        await _db.SaveChangesAsync();
                        sinceLastFlush = 0;
                        if (await IsCancelledAsync(job.Id, hangfireCt)) {
                            await MarkTerminalAsync(job, "cancelled", null, null, projectsSynced, tasksUpserted, sw, tasksSkippedUnchanged: Math.Max(0, initialCacheCount - existingRowsUpdated));
                            await InvalidateMirroredCachesAsync(conn.OrgId, CancellationToken.None);
                            return;
                        }
                    }
                }

                // Flush leftovers from the final partial chunk.
                if (sinceLastFlush > 0) {
                    await _db.SaveChangesAsync();
                }

                projectsSynced++;
                doneCounter++;

                // Persist progress every project so the UI sees movement.
                job.ProgressDone = doneCounter;
                await _db.SaveChangesAsync();
            }

            // Rows that lived in the cache but the adapter never yielded
            // this run were filtered out by `since` — count them as
            // "unchanged upstream." Computed once after all projects
            // because the cache is connection-wide.
            tasksSkippedUnchanged = Math.Max(0, initialCacheCount - existingRowsUpdated);

            // Third pass — pull existing upstream time entries into the
            // local worklogs table so the calendar can render them.
            // Skips silently when:
            //   * the adapter doesn't support pull (Jira/Linear/GitLab stub)
            //   * the connection has no UpstreamUserId (verify never ran)
            //   * the connection's CreatedBy was nulled by a GDPR delete
            //     (no local user to assign to)
            //
            // Window:
            //   * incremental sync — last 90 days. Cheap; covers everything
            //     the user might still be editing in upstream.
            //   * full re-sync — go back to 2000-01-01 (effectively no
            //     lower bound). Users often have years of upstream history
            //     predating the TimeFlow connection itself, so anchoring
            //     the floor at `conn.CreatedAt` would miss everything they
            //     tracked before installing us. The idempotency guard on
            //     (UpstreamWorklogId, UpstreamTaskId) means re-running is
            //     safe — duplicates don't land.
            var worklogsImported = 0;
            var worklogsSkippedNoTask = 0;
            if (!string.IsNullOrEmpty(conn.UpstreamUserId) && conn.CreatedBy is Guid assignTo) {
                var pullFrom = job.FullResync
                    ? new DateOnly(2000, 1, 1)
                    : DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-90));
                var pullTo = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));

                // Batch-load both per-worklog lookups ONCE instead of two
                // queries per imported entry (the old hot path was 2×N).
                //
                // Task resolution: the `existing` cache is already keyed by
                // upstream_task_id connection-wide (matching the unique
                // index) and now holds every task this run touched, so it
                // doubles as the worklog→task resolver.
                //
                // Idempotency: pre-load the set of (task_id,
                // upstream_worklog_id) pairs already imported for this
                // connection's tasks. Same natural key the per-row AnyAsync
                // used; just materialised up front.
                var connTaskIds = existing.Values
                    .Where(t => t.Id != Guid.Empty)
                    .Select(t => t.Id)
                    .ToHashSet();
                var importedKeys = (await _db.Worklogs
                        .Where(x => x.TaskId != null && x.UpstreamWorklogId != null
                            && connTaskIds.Contains(x.TaskId!.Value))
                        .Select(x => new { TaskId = x.TaskId!.Value, x.UpstreamWorklogId })
                        .ToListAsync(hangfireCt.ShutdownToken))
                    .Select(x => (x.TaskId, x.UpstreamWorklogId!))
                    .ToHashSet();

                // Project resolver for lazy task mirroring: when a worklog
                // points at an upstream task whose work_package wasn't
                // pulled by ListTasksAsync (because the user isn't the
                // assignee), we still need to land the worklog locally —
                // so we fetch the work_package on demand and upsert it.
                // That upsert needs the LOCAL NativeProject row for the
                // task's upstream project, hence this cache.
                var projectsByUpstreamId = await _db.NativeProjects
                    .Where(p => p.ConnectionId == conn.Id && p.UpstreamProjectId != null)
                    .ToDictionaryAsync(p => p.UpstreamProjectId!, hangfireCt.ShutdownToken);

                // Wrapper project: where lazily-created sub-projects get
                // re-parented if their upstream project wasn't mirrored
                // yet (mirrors UpsertProjectAsync's anchoring rule).
                var wrapperId = await _db.NativeProjects
                    .Where(w => w.ConnectionId == conn.Id && w.UpstreamProjectId == null)
                    .Select(w => (Guid?)w.Id)
                    .FirstOrDefaultAsync(hangfireCt.ShutdownToken) ?? conn.ProjectId;

                await foreach (var w in adapter.ListWorklogsAsync(
                    creds, pullFrom, pullTo, conn.UpstreamUserId, hangfireCt.ShutdownToken)) {
                    if (await IsCancelledAsync(job.Id, hangfireCt)) {
                        await MarkTerminalAsync(job, "cancelled", null, null, projectsSynced, tasksUpserted, sw, worklogsImported, worklogsSkippedNoTask);
                        await InvalidateMirroredCachesAsync(conn.OrgId, CancellationToken.None);
                        return;
                    }
                    var outcome = await UpsertWorklogAsync(
                        conn, assignTo, w, existing, importedKeys,
                        adapter, creds, projectsByUpstreamId, wrapperId,
                        hangfireCt.ShutdownToken);
                    if (outcome == WorklogImportOutcome.Imported) worklogsImported++;
                    else if (outcome == WorklogImportOutcome.SkippedNoTask) worklogsSkippedNoTask++;
                }
            }

            await MarkTerminalAsync(job, "succeeded", null, null, projectsSynced, tasksUpserted, sw, worklogsImported, worklogsSkippedNoTask, tasksSkippedUnchanged);
            // Drop the read-through caches for everything this run mirrored.
            // Done once at completion (not per-chunk) so a single sync
            // invalidates at most one tag-batch instead of thousands.
            await InvalidateMirroredCachesAsync(conn.OrgId, hangfireCt.ShutdownToken);
        } catch (UpstreamIntegrationException ex) {
            _log.LogWarning(ex, "WorklogSyncJob: upstream error during sync of connection {ConnectionId}", conn.Id);
            await MarkTerminalAsync(job, "failed", ex.Class.ToString().ToLowerInvariant(), ex.Message, projectsSynced, tasksUpserted, sw, tasksSkippedUnchanged: tasksSkippedUnchanged);
            // A partially-failed run may have committed rows in earlier
            // chunks — invalidate so reads don't serve a stale mix.
            await InvalidateMirroredCachesAsync(conn.OrgId, CancellationToken.None);
        } catch (OperationCanceledException) {
            // Hangfire told us to shut down — mark cancelled and let the
            // platform reschedule on the next process boot (Hangfire's
            // retry config decides).
            await MarkTerminalAsync(job, "cancelled", null, "Process shutdown.", projectsSynced, tasksUpserted, sw, tasksSkippedUnchanged: tasksSkippedUnchanged);
            // Rows committed before the shutdown still need their caches
            // dropped. ShutdownToken is already tripped, so don't thread it.
            await InvalidateMirroredCachesAsync(conn.OrgId, CancellationToken.None);
            throw;
        } catch (Exception ex) {
            _log.LogError(ex, "WorklogSyncJob: unexpected error during sync of connection {ConnectionId}", conn.Id);
            await MarkTerminalAsync(job, "failed", "generic", "Unexpected sync error — check server logs.", projectsSynced, tasksUpserted, sw, tasksSkippedUnchanged: tasksSkippedUnchanged);
            await InvalidateMirroredCachesAsync(conn.OrgId, CancellationToken.None);
        }
    }

    // The sync mirrors projects, tasks and worklogs into the org's tables.
    // All three read paths are cache-aside; invalidate every tag this run
    // could have touched so the calendar/projects/tasks views reflect the
    // fresh mirror instead of waiting out the 2-min TTL.
    private async Task InvalidateMirroredCachesAsync(Guid orgId, CancellationToken ct) {
        try {
            await _cache.InvalidateTagsAsync(new[] {
                $"org:{orgId:N}:projects",
                $"org:{orgId:N}:tasks",
                $"org:{orgId:N}:worklogs",
            }, ct);
        } catch (Exception ex) {
            // A cache miss-to-invalidate is recoverable (TTL still expires
            // the stale entry); never let it crash a sync that already
            // committed its rows.
            _log.LogError(ex, "WorklogSyncJob: cache invalidation failed for org {OrgId}", orgId);
        }
    }

    private async Task<NativeProject> UpsertProjectAsync(IntegrationConnection conn, IntegrationProject p) {
        // Mirrored upstream projects land under the connection's WRAPPER
        // project (engagement → wrapper → upstream sub-projects). The
        // wrapper is the row created by IntegrationEndpoints.Create with
        // (connection_id = conn.Id, upstream_project_id = NULL). Fall back
        // to the engagement if no wrapper exists (legacy connections from
        // before the wrapper concept landed).
        var wrapperId = await _db.NativeProjects
            .Where(w => w.ConnectionId == conn.Id && w.UpstreamProjectId == null)
            .Select(w => (Guid?)w.Id)
            .FirstOrDefaultAsync() ?? conn.ProjectId;

        var existing = await _db.NativeProjects
            .FirstOrDefaultAsync(u => u.ConnectionId == conn.Id && u.UpstreamProjectId == p.Id);
        // Width-safe casts — upstream names run wider than native_projects.name's
        // varchar(160) limit. Truncate consistently with Phase B backfill.
        var name = p.Name.Length > 160 ? p.Name[..160] : p.Name;
        var code = string.IsNullOrWhiteSpace(p.Code) ? null
            : (p.Code!.Length > 40 ? p.Code[..40] : p.Code);
        if (existing is null) {
            existing = new NativeProject {
                OrgId = conn.OrgId,
                ConnectionId = conn.Id,
                UpstreamProjectId = p.Id,
                ParentProjectId = wrapperId,
                Name = name,
                Code = code,
                Archived = !p.Active,
                Type = "subproject",
                LastSyncedAt = DateTime.UtcNow,
            };
            _db.NativeProjects.Add(existing);
        } else {
            existing.Name = name;
            existing.Code = code;
            existing.Archived = !p.Active;
            existing.LastSyncedAt = DateTime.UtcNow;
            // Re-anchor under the wrapper in case it was missing before
            // (legacy migration) or the connection got re-pointed.
            existing.ParentProjectId = wrapperId;
        }
        await _db.SaveChangesAsync();
        return existing;
    }

    private enum WorklogImportOutcome { Imported, AlreadyImported, SkippedNoTask }

    /// <summary>
    /// Insert one upstream time entry as a local <c>Worklog</c> row.
    /// Returns <see cref="WorklogImportOutcome.Imported"/> on insert,
    /// <see cref="WorklogImportOutcome.AlreadyImported"/> on idempotent hit,
    /// or <see cref="WorklogImportOutcome.SkippedNoTask"/> when the upstream
    /// task can't be located at all (deleted upstream or upstream returned
    /// 404). Tasks merely absent from the pre-loaded assignee shortlist are
    /// lazily fetched + mirrored here so worklogs against teammates' tasks
    /// still land in the calendar — this was the source of the
    /// "missing hours" bug where users contributing time to work_packages
    /// they didn't own saw those entries dropped.
    /// </summary>
    private async Task<WorklogImportOutcome> UpsertWorklogAsync(
        IntegrationConnection conn, Guid assignTo, IntegrationWorklogEntry w,
        Dictionary<string, NativeTask> tasksByUpstreamId,
        HashSet<(Guid TaskId, string UpstreamWorklogId)> importedKeys,
        IProjectIntegration adapter, IntegrationCredentials creds,
        Dictionary<string, NativeProject> projectsByUpstreamId,
        Guid wrapperProjectId,
        CancellationToken ct) {
        // Phase C — resolve the LOCAL Task row via the mirror tuple
        // (connection_id, upstream_task_id). The cache is keyed exactly on
        // upstream_task_id connection-wide, so a hit here is equivalent to
        // the old per-row query.
        if (!tasksByUpstreamId.TryGetValue(w.TaskUpstreamId, out var task)) {
            // Lazy mirror: the pre-load only pulls tasks assigned to the
            // connection's upstream user (see ListTasksAsync call above).
            // But OpenProject lets anyone log time against any
            // work_package, so users routinely contribute hours to bugs
            // owned by someone else. Without this fetch those hours
            // silently vanish from the calendar.
            task = await LazyMirrorTaskAsync(
                conn, w.TaskUpstreamId, adapter, creds,
                tasksByUpstreamId, projectsByUpstreamId, wrapperProjectId, ct);
            if (task is null) return WorklogImportOutcome.SkippedNoTask;
        }

        // Idempotency: the natural key for imports is (task_id,
        // upstream_worklog_id). Pre-loaded into `importedKeys`; we also add
        // freshly-inserted keys so a duplicate within this same upstream
        // batch doesn't double-insert.
        var key = (task.Id, w.UpstreamId);
        if (importedKeys.Contains(key)) return WorklogImportOutcome.AlreadyImported;

        _db.Worklogs.Add(new Worklog {
            OrgId = conn.OrgId,
            UserId = assignTo,
            ProjectId = task.ProjectId,
            TaskId = task.Id,
            WorkDate = w.WorkDate,
            Hours = w.Hours,
            Notes = w.Comment,
            Source = "import",
            PushStatus = "pushed",
            UpstreamWorklogId = w.UpstreamId,
        });
        await _db.SaveChangesAsync();
        importedKeys.Add(key);
        return WorklogImportOutcome.Imported;
    }

    /// <summary>
    /// Fetch a single upstream work_package on demand and mirror it as a
    /// NativeTask (and, if its parent project isn't mirrored yet, a minimal
    /// NativeProject too). Returns null when upstream returns 404 or fails
    /// — caller treats that as SkippedNoTask. Caches the resolved task in
    /// <paramref name="tasksByUpstreamId"/> so a same-batch second worklog
    /// against the same task is a dictionary hit, not another HTTP call.
    /// </summary>
    private async Task<NativeTask?> LazyMirrorTaskAsync(
        IntegrationConnection conn, string upstreamTaskId,
        IProjectIntegration adapter, IntegrationCredentials creds,
        Dictionary<string, NativeTask> tasksByUpstreamId,
        Dictionary<string, NativeProject> projectsByUpstreamId,
        Guid wrapperProjectId,
        CancellationToken ct) {
        IntegrationTask? upstream;
        try {
            upstream = await adapter.GetTaskAsync(creds, upstreamTaskId, ct);
        } catch (UpstreamIntegrationException ex) {
            // Single-task lookup failures shouldn't poison the whole
            // worklog import — log and move on so other entries land.
            _log.LogWarning(ex, "WorklogSyncJob: GetTaskAsync({TaskId}) failed for connection {ConnectionId}", upstreamTaskId, conn.Id);
            return null;
        }
        if (upstream is null) return null;

        // Resolve the local NativeProject row for the task's upstream
        // project. If we never mirrored that project (user contributed to
        // a project outside their assigned set), stand up a placeholder
        // anchored under the connection's wrapper — the next FullResync
        // will replace the placeholder name with the real one via
        // UpsertProjectAsync's name/code refresh path.
        if (!projectsByUpstreamId.TryGetValue(upstream.ProjectId, out var project)) {
            project = new NativeProject {
                OrgId = conn.OrgId,
                ConnectionId = conn.Id,
                UpstreamProjectId = upstream.ProjectId,
                ParentProjectId = wrapperProjectId,
                Name = $"Project {upstream.ProjectId}",
                Code = null,
                Archived = false,
                Type = "subproject",
                LastSyncedAt = DateTime.UtcNow,
            };
            _db.NativeProjects.Add(project);
            await _db.SaveChangesAsync();
            projectsByUpstreamId[upstream.ProjectId] = project;
        }

        var task = new NativeTask {
            ProjectId = project.Id,
            OrgId = conn.OrgId,
            ConnectionId = conn.Id,
            UpstreamTaskId = upstream.Id,
            Title = upstream.Title.Length > 200 ? upstream.Title[..200] : upstream.Title,
            Status = string.IsNullOrWhiteSpace(upstream.Status)
                ? "open"
                : (upstream.Status.Length > 40 ? upstream.Status[..40] : upstream.Status),
            AssigneeUpstreamId = upstream.AssigneeId,
            UpstreamUpdatedAt = upstream.UpdatedAt,
            UpstreamVersionId = upstream.VersionId,
            UpstreamVersionName = upstream.VersionName,
            UpstreamRawJson = upstream.Raw,
        };
        _db.NativeTasks.Add(task);
        await _db.SaveChangesAsync();
        tasksByUpstreamId[upstream.Id] = task;
        return task;
    }

    private async Task<bool> IsCancelledAsync(Guid jobId, IJobCancellationToken hangfireCt) {
        if (hangfireCt.ShutdownToken.IsCancellationRequested) return true;
        // Re-fetch the row from DB — the user's cancel POST writes to this
        // column, so without a fresh read we'd miss the signal.
        var requested = await _db.IntegrationSyncJobs
            .Where(j => j.Id == jobId)
            .Select(j => j.CancelRequested)
            .FirstAsync();
        return requested;
    }

    private async Task MarkTerminalAsync(
        IntegrationSyncJob job, string status, string? errorCode, string? errorMessage,
        int projectsSynced, int tasksUpserted, Stopwatch sw,
        int worklogsImported = 0, int worklogsSkippedNoTask = 0, int tasksSkippedUnchanged = 0) {
        // If we got here from a catch block, the change tracker may still
        // hold a poisoned entity (e.g. the NativeTask whose timestamp
        // SaveChanges rejected). Trying to save the job update with that
        // pending entity would replay the failure and leave the row
        // stuck as 'running'. Clear the tracker + re-attach a fresh job
        // row sourced directly from the DB.
        _db.ChangeTracker.Clear();
        var fresh = await _db.IntegrationSyncJobs.FirstOrDefaultAsync(j => j.Id == job.Id);
        if (fresh is null) return; // someone deleted the row mid-flight
        fresh.Status = status;
        fresh.ErrorCode = errorCode;
        fresh.ErrorMessage = errorMessage;
        fresh.FinishedAt = DateTime.UtcNow;
        fresh.SummaryJson = JsonSerializer.Serialize(new {
            projectsSynced,
            tasksUpserted,
            tasksSkippedUnchanged,
            worklogsImported,
            worklogsSkippedNoTask,
            durationMs = sw.ElapsedMilliseconds,
        }, JsonOpts);
        try {
            await _db.SaveChangesAsync();
        } catch (Exception ex) {
            // Last-ditch: even the terminal write failed. Log loudly so
            // ops sees a stuck job before the user complains.
            _log.LogError(ex, "WorklogSyncJob: could not persist terminal status for job {JobId}", job.Id);
        }
    }
}
