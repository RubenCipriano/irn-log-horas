namespace TimeFlow.Integrations.Contract;

// Provider-neutral DTOs the API surface speaks. Each adapter normalises
// its upstream shape into these so the calling code (calendar UI, AI
// distribution, sync worker) doesn't need a switch on provider every
// time it touches a project or task.
//
// `Raw` holds the unmodified upstream JSON object as a string so
// debugging + future-proofing don't require an adapter round-trip.

/// <summary>Upstream project (or "team" in Linear terms, or "group" in some GitLab contexts).</summary>
public sealed record IntegrationProject(
    string Id,
    string Name,
    string? Code,
    bool Active,
    string? Raw);

/// <summary>Upstream task / work-package / issue / merge-request.</summary>
public sealed record IntegrationTask(
    string Id,
    string ProjectId,
    string Title,
    string Status,
    string? AssigneeId,
    DateTime? UpdatedAt,
    string? Raw,
    /// <summary>Upstream sprint/iteration/version id (OpenProject version id, Linear cycle id, ...). Null when not assigned.</summary>
    string? VersionId = null,
    /// <summary>Human-readable sprint/iteration label.</summary>
    string? VersionName = null);

/// <summary>Input for creating a task upstream. All optional fields are nullable.</summary>
public sealed record IntegrationTaskCreateInput(
    string Title,
    string? Status,
    string? AssigneeId,
    string? VersionId,
    string? Description);

/// <summary>PATCH-style task update. Null fields = leave unchanged.</summary>
public sealed record IntegrationTaskUpdateInput(
    string? Title,
    string? Status,
    string? AssigneeId,
    string? VersionId,
    string? Description);

/// <summary>Result of pushing a worklog upstream.</summary>
public sealed record IntegrationWorklogResult(
    string UpstreamId,
    string TaskId,
    decimal Hours,
    DateOnly Date);

/// <summary>
/// A single time entry retrieved FROM upstream (the inverse direction
/// of <see cref="IntegrationWorklogResult"/>). Consumed by the
/// `WorklogSyncJob` to import worklogs the user logged directly in
/// OpenProject / Jira / etc. into the local <c>worklogs</c> table.
/// </summary>
public sealed record IntegrationWorklogEntry(
    /// <summary>Upstream natural id (the time-entry's own id). Used for idempotency.</summary>
    string UpstreamId,
    /// <summary>Upstream id of the task/work-package/issue this entry is against.</summary>
    string TaskUpstreamId,
    /// <summary>Upstream user id who logged the entry — null if unknown/system.</summary>
    string? UserUpstreamId,
    DateOnly WorkDate,
    decimal Hours,
    string? Comment);

/// <summary>Result of /verify — minimal probe of the credential.</summary>
public sealed record IntegrationVerifyResult(
    bool Ok,
    string? UserId,
    string? UserName,
    string? UserEmail);
