namespace TimeFlow.Data.Models;

// A single hour entry. Always points at a NativeProject (ProjectId
// required) with an optional NativeTask (TaskId). Phase C collapsed the
// old (ProjectId | UpstreamTaskId) split: upstream mirroring lives on
// the task row now, so a worklog whose task carries a mirror tuple
// pushes upstream automatically.
//
// Upstream push lifecycle:
//   1. POST /worklogs against a NativeTask whose ConnectionId +
//      UpstreamTaskId are set → row inserted with PushStatus="pending"
//   2. Hangfire job `WorklogPushJob.PushAsync(id)` reads the mirror
//      tuple from the task, decrypts creds, calls
//      adapter.PostWorklogAsync, writes back UpstreamWorklogId and
//      PushStatus="pushed"
//   3. On failure, PushStatus="failed" + Hangfire retries per its
//      default backoff
//   Worklogs against locally-created projects/tasks stay at
//   PushStatus="none" forever — nothing to push.
//
// `Hours` is `numeric(5,2)` — supports up to 999.99 (more than any
// real day) and avoids float drift on sums.
public sealed class Worklog {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrgId { get; set; }
    public Guid UserId { get; set; }

    /// <summary>NativeProject the hours are logged against. Required.</summary>
    public Guid? ProjectId { get; set; }

    /// <summary>NativeTask under ProjectId. Optional; null means "project-level admin time".</summary>
    public Guid? TaskId { get; set; }

    public DateOnly WorkDate { get; set; }

    /// <summary>Hours logged. 0.25-step granularity is the UI contract; DB allows finer.</summary>
    public decimal Hours { get; set; }

    public string? Notes { get; set; }
    public string? Source { get; set; } // "manual" | "ai" | "import" — null treated as "manual"

    /// <summary>"none" (native) | "pending" | "pushed" | "failed". Drives the UI badge.</summary>
    public string PushStatus { get; set; } = "none";

    /// <summary>Upstream worklog id returned by adapter.PostWorklogAsync on success.</summary>
    public string? UpstreamWorklogId { get; set; }

    /// <summary>Last push attempt error code (bucketed) — null on success or never-tried.</summary>
    public string? PushErrorCode { get; set; }

    /// <summary>
    /// True when the hour is meant to be billed to a client. Backend
    /// defaults the value at create time based on whether the project is
    /// linked to a client; the user can override per row.
    /// </summary>
    public bool IsBillable { get; set; } = true;

    /// <summary>
    /// Pointer to the InvoiceLine this hour ended up on (null while
    /// un-invoiced). Generation flips this to the new line's id; voiding
    /// or deleting the invoice clears it back to null so the hours become
    /// available for the next invoice.
    /// </summary>
    public Guid? InvoiceLineId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
