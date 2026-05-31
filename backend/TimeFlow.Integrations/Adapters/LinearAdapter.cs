using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TimeFlow.Integrations.Contract;

namespace TimeFlow.Integrations.Adapters;

// Linear (https://api.linear.app/graphql). Auth: `Authorization: <token>`
// (no "Bearer" prefix — Linear's own quirk). Everything is GraphQL;
// pagination via Relay-style cursors (`first`, `after`, `pageInfo`).
//
// Linear's "project" maps to our IntegrationProject; their "issue" maps
// to IntegrationTask. We DO surface `teamId` as the Project for
// listProjects because most consultancies organise around teams, not
// the project-grouping feature.
//
// Worklog support: Linear has no native time tracking, so PostWorklog
// posts a comment instead — Phase 9's AI flow will offer this with a
// "Linear doesn't track hours; logging as comment" notice in the UI.
public sealed class LinearAdapter : IProjectIntegration {
    public string Provider => IntegrationProviders.Linear;
    private const string Endpoint = "https://api.linear.app/graphql";
    private readonly HttpClient _http;
    public LinearAdapter(HttpClient http) { _http = http; }

    public async Task<IntegrationVerifyResult> VerifyAsync(IntegrationCredentials creds, CancellationToken ct = default) {
        var c = (LinearCredentials)creds;
        var json = await PostQueryAsync(c.Token, "{ viewer { id name email } }", ct: ct);
        var viewer = json.GetProperty("data").GetProperty("viewer");
        return new IntegrationVerifyResult(
            Ok: true,
            UserId: viewer.TryGet("id")?.GetString(),
            UserName: viewer.TryGet("name")?.GetString(),
            UserEmail: viewer.TryGet("email")?.GetString());
    }

    public async IAsyncEnumerable<IntegrationProject> ListProjectsAsync(
        IntegrationCredentials creds, int maxItems = 100, [EnumeratorCancellation] CancellationToken ct = default) {
        var c = (LinearCredentials)creds;
        var query = $@"
            query {{
                teams(first: {Math.Min(maxItems, 100)}) {{
                    nodes {{ id key name }}
                }}
            }}";
        var json = await PostQueryAsync(c.Token, query, ct: ct);
        var nodes = json.GetProperty("data").GetProperty("teams").GetProperty("nodes");
        var n = 0;
        foreach (var t in nodes.EnumerateArray()) {
            if (n++ >= maxItems) yield break;
            yield return new IntegrationProject(
                Id: t.GetProperty("id").GetString()!,
                Name: t.TryGet("name")?.GetString() ?? "",
                Code: t.TryGet("key")?.GetString(),
                Active: true,
                Raw: t.GetRawText());
        }
    }

    public async IAsyncEnumerable<IntegrationTask> ListTasksAsync(
        IntegrationCredentials creds, string projectId, int maxItems = 200, DateTime? since = null,
        string? assigneeUpstreamId = null,
        [EnumeratorCancellation] CancellationToken ct = default) {
        // `since` + `assigneeUpstreamId` ignored — Linear supports both via
        // GraphQL filter args but no production Linear connection exists
        // yet, defer.
        _ = since;
        _ = assigneeUpstreamId;
        var c = (LinearCredentials)creds;
        // `projectId` here is a Linear TEAM id. Filter issues by team.
        var query = $@"
            query($teamId: String!) {{
                issues(first: {Math.Min(maxItems, 100)}, filter: {{ team: {{ id: {{ eq: $teamId }} }} }}) {{
                    nodes {{
                        id identifier title updatedAt
                        state {{ name }}
                        assignee {{ id }}
                    }}
                }}
            }}";
        var json = await PostQueryAsync(c.Token, query, variables: new { teamId = projectId }, ct: ct);
        var nodes = json.GetProperty("data").GetProperty("issues").GetProperty("nodes");
        var n = 0;
        foreach (var i in nodes.EnumerateArray()) {
            if (n++ >= maxItems) yield break;
            yield return MapIssue(i, projectId);
        }
    }

    public async Task<IntegrationTask?> GetTaskAsync(IntegrationCredentials creds, string taskId, CancellationToken ct = default) {
        var c = (LinearCredentials)creds;
        var query = @"
            query($id: String!) {
                issue(id: $id) {
                    id identifier title updatedAt
                    state { name }
                    assignee { id }
                    team { id }
                }
            }";
        var json = await PostQueryAsync(c.Token, query, variables: new { id = taskId }, ct: ct);
        var issue = json.GetProperty("data").TryGet("issue");
        if (issue is null || issue.Value.ValueKind == JsonValueKind.Null) return null;
        var teamId = issue.Value.TryGet("team")?.TryGet("id")?.GetString() ?? "";
        return MapIssue(issue.Value, teamId);
    }

    public Task<IntegrationTask> CreateTaskAsync(
        IntegrationCredentials creds, string projectId, IntegrationTaskCreateInput input,
        CancellationToken ct = default) =>
        throw new NotSupportedException("Linear issue creation is not supported in this build.");

    public Task<IntegrationTask> UpdateTaskAsync(
        IntegrationCredentials creds, string taskId, IntegrationTaskUpdateInput input,
        CancellationToken ct = default) =>
        throw new NotSupportedException("Linear issue editing is not supported in this build.");

    public async IAsyncEnumerable<IntegrationWorklogEntry> ListWorklogsAsync(
        IntegrationCredentials creds, DateOnly from, DateOnly to, string? upstreamUserId,
        [EnumeratorCancellation] CancellationToken ct = default) {
        // Linear has no native time tracking — the comment-fallback used by
        // PostWorklogAsync above can't be reversed reliably. Nothing to pull.
        await Task.CompletedTask;
        yield break;
    }

    public async Task<IntegrationWorklogResult> PostWorklogAsync(
        IntegrationCredentials creds, string taskId, decimal hours, DateOnly date, string? comment,
        CancellationToken ct = default) {
        var c = (LinearCredentials)creds;
        // No native worklog in Linear — record as a comment so the
        // upstream still has the audit trail.
        var body = comment ?? $"Logged {hours}h on {date:yyyy-MM-dd} via TimeFlow.";
        var query = @"
            mutation($issueId: String!, $body: String!) {
                commentCreate(input: { issueId: $issueId, body: $body }) {
                    success
                    comment { id }
                }
            }";
        var json = await PostQueryAsync(c.Token, query, variables: new { issueId = taskId, body }, ct: ct);
        var commentId = json.GetProperty("data").GetProperty("commentCreate").GetProperty("comment").GetProperty("id").GetString();
        return new IntegrationWorklogResult(
            UpstreamId: commentId ?? "",
            TaskId: taskId,
            Hours: hours,
            Date: date);
    }

    // ---------------------------------------------------------------------
    // Internal — GraphQL POST + GraphQL error mapping.
    // ---------------------------------------------------------------------
    private async Task<JsonElement> PostQueryAsync(string token, string query, object? variables = null, CancellationToken ct = default) {
        var req = HttpHelpers.Json(HttpMethod.Post, Endpoint, new { query, variables });
        req.Headers.Authorization = new AuthenticationHeaderValue(token);
        var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);

        // GraphQL returns 200 even on errors — surface them as upstream-auth
        // when present so the calling layer reacts the same as for HTTP 401.
        if (json.TryGet("errors") is { } errors && errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0) {
            throw new UpstreamIntegrationException(
                Provider,
                UpstreamErrorClass.Generic,
                "Upstream returned GraphQL errors.",
                upstreamBody: errors.GetRawText());
        }
        return json;
    }

    private static IntegrationTask MapIssue(JsonElement i, string projectId) {
        var state = i.TryGet("state")?.TryGet("name")?.GetString() ?? "unknown";
        var assigneeId = i.TryGet("assignee")?.TryGet("id")?.GetString();
        var updated = HttpHelpers.ParseUpstreamUtc(i.TryGet("updatedAt")?.GetString());
        return new IntegrationTask(
            Id: i.GetProperty("id").GetString()!,
            ProjectId: projectId,
            Title: i.TryGet("title")?.GetString() ?? "",
            Status: state,
            AssigneeId: assigneeId,
            UpdatedAt: updated,
            Raw: i.GetRawText());
    }
}
