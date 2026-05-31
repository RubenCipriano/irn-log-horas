namespace TimeFlow.Data.Models;

// Task under a NativeProject. Status is a free string for now (the
// legacy stack used "open", "in_progress", "review", "done", "blocked")
// — Phase 9's AI surfaces care about the value but the data layer
// doesn't need an enum yet.
public sealed class NativeTask {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjectId { get; set; }
    public Guid OrgId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Status { get; set; } = "open";

    /// <summary>SET NULL on user delete (anonymisation cascade).</summary>
    public Guid? AssigneeId { get; set; }

    /// <summary>SET NULL on user delete.</summary>
    public Guid? CreatedBy { get; set; }

    /// <summary>
    /// When this Task mirrors an upstream tracker work-item, the
    /// `(connection_id, upstream_task_id)` tuple is its natural key. Both
    /// fields are immutable after creation — re-sync updates the title /
    /// status / version but not the origin.
    /// </summary>
    public Guid? ConnectionId { get; set; }
    public string? UpstreamTaskId { get; set; }

    /// <summary>Sprint/version on the upstream tracker (replaces the old upstream_tasks columns).</summary>
    public string? UpstreamVersionId { get; set; }
    public string? UpstreamVersionName { get; set; }

    /// <summary>Upstream's `updated_at` — delta-sync watermark.</summary>
    public DateTime? UpstreamUpdatedAt { get; set; }

    /// <summary>
    /// Upstream user id (string, provider-specific). Separate from
    /// `AssigneeId` which is a TimeFlow user FK.
    /// </summary>
    public string? AssigneeUpstreamId { get; set; }

    /// <summary>Raw last-sync payload (for debugging).</summary>
    public string? UpstreamRawJson { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public NativeProject? Project { get; set; }
    public IntegrationConnection? Connection { get; set; }
}
