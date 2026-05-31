namespace TimeFlow.Integrations.Contract;

// Adapter contract — one implementation per upstream tracker.
//
// Design notes:
//   * `creds` is passed per-call, not stored on the adapter, so the
//     same adapter instance can serve many orgs concurrently.
//   * `IAsyncEnumerable` for paginated reads so the sync worker (Phase
//     8) can stream + checkpoint per page. List endpoints with a small
//     `maxItems` cap are good enough for UI use.
//   * Errors bubble as `UpstreamIntegrationException` carrying status
//     class (auth / server / other) — the API layer maps that into a
//     bucketed user-facing error per the CLAUDE.md security baseline
//     (never echo upstream bodies verbatim).
public interface IProjectIntegration {
    /// <summary>Provider key (see IntegrationProviders).</summary>
    string Provider { get; }

    /// <summary>Cheap probe: validate credentials + return current user info.</summary>
    Task<IntegrationVerifyResult> VerifyAsync(IntegrationCredentials creds, CancellationToken ct = default);

    /// <summary>List upstream projects the credential can see. Bounded at <paramref name="maxItems"/>.</summary>
    IAsyncEnumerable<IntegrationProject> ListProjectsAsync(IntegrationCredentials creds, int maxItems = 100, CancellationToken ct = default);

    /// <summary>
    /// List tasks under a specific project. Bounded at <paramref name="maxItems"/>.
    /// When <paramref name="since"/> is non-null the adapter SHOULD only yield
    /// tasks whose upstream <c>updatedAt &gt; since</c>; the caller passes this
    /// from a per-connection watermark so re-syncs become cheap delta pulls.
    /// When <paramref name="assigneeUpstreamId"/> is non-null the adapter
    /// SHOULD only yield tasks assigned to that upstream user — the caller
    /// uses this on per-user connections to skip the 99% of tasks the user
    /// will never log time against. Adapters that don't support either
    /// filter MAY ignore the parameter and yield the full set (correctness
    /// over speed).
    /// </summary>
    IAsyncEnumerable<IntegrationTask> ListTasksAsync(IntegrationCredentials creds, string projectId, int maxItems = 200, DateTime? since = null, string? assigneeUpstreamId = null, CancellationToken ct = default);

    /// <summary>Fetch a single task by upstream id. Null if not found.</summary>
    Task<IntegrationTask?> GetTaskAsync(IntegrationCredentials creds, string taskId, CancellationToken ct = default);

    /// <summary>
    /// Create a task upstream. Adapters that don't support task writes
    /// (Jira/Linear/GitLab today) throw <see cref="NotSupportedException"/>;
    /// the API layer translates that to a 501 with a friendly error.
    /// </summary>
    Task<IntegrationTask> CreateTaskAsync(
        IntegrationCredentials creds,
        string projectId,
        IntegrationTaskCreateInput input,
        CancellationToken ct = default);

    /// <summary>
    /// Update fields on an existing task. All input fields are nullable —
    /// only non-null fields are sent through. Same not-supported contract.
    /// </summary>
    Task<IntegrationTask> UpdateTaskAsync(
        IntegrationCredentials creds,
        string taskId,
        IntegrationTaskUpdateInput input,
        CancellationToken ct = default);

    /// <summary>Push a worklog upstream. Returns the upstream worklog id for traceability.</summary>
    Task<IntegrationWorklogResult> PostWorklogAsync(
        IntegrationCredentials creds,
        string taskId,
        decimal hours,
        DateOnly date,
        string? comment,
        CancellationToken ct = default);

    /// <summary>
    /// Pull time entries the user already logged upstream so the local
    /// calendar can display them. When <paramref name="upstreamUserId"/>
    /// is set the implementation MUST filter to that user only
    /// (multi-user import is a separate concern).
    /// </summary>
    IAsyncEnumerable<IntegrationWorklogEntry> ListWorklogsAsync(
        IntegrationCredentials creds,
        DateOnly from,
        DateOnly to,
        string? upstreamUserId,
        CancellationToken ct = default);
}
