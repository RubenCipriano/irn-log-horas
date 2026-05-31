namespace TimeFlow.Data.Models;

// Trace row for a single sync run. One per `POST /sync` (or per
// recurring tick once we add scheduling). Hangfire owns the actual
// execution + retry; this row is what the UI polls.
//
// State machine: queued → running → (succeeded | failed | cancelled).
// Once terminal, the row is immutable.
public sealed class IntegrationSyncJob {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrgId { get; set; }
    public Guid ConnectionId { get; set; }

    /// <summary>"pull" today; future kinds: "verify", "incremental", etc.</summary>
    public string Kind { get; set; } = "pull";

    /// <summary>"queued" | "running" | "succeeded" | "failed" | "cancelled".</summary>
    public string Status { get; set; } = "queued";

    /// <summary>Projects + tasks the worker plans to touch. -1 = unknown yet.</summary>
    public int ProgressTotal { get; set; } = -1;

    /// <summary>Items completed so far. Bumped per-task by the worker.</summary>
    public int ProgressDone { get; set; }

    /// <summary>Cooperative cancellation flag — worker polls this between iterations.</summary>
    public bool CancelRequested { get; set; }

    /// <summary>
    /// True when the user explicitly asked for a full re-sync (ignores the
    /// per-connection <c>upstream_updated_at</c> watermark, so every task
    /// is refetched). Default false — the normal sync is delta-only.
    /// </summary>
    public bool FullResync { get; set; }

    /// <summary>Bucketed error class (`auth`/`server`/`network`/`generic`) on failure.</summary>
    public string? ErrorCode { get; set; }
    /// <summary>Human-readable error message (safe to show users). Never raw upstream body.</summary>
    public string? ErrorMessage { get; set; }

    /// <summary>JSON: `{ projectsSynced, tasksUpserted, durationMs }` at finish time.</summary>
    public string? SummaryJson { get; set; }

    /// <summary>SET NULL on user delete (GDPR cascade).</summary>
    public Guid? StartedBy { get; set; }

    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
