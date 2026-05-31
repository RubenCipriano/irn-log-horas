using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using TimeFlow.Integrations.Contract;

namespace TimeFlow.Integrations.Adapters;

// Atlassian Jira Cloud (REST API v3). Auth: HTTP Basic with
// `email:api_token`. Pagination: `startAt`/`maxResults`/`isLast`.
// Worklog post: POST /rest/api/3/issue/{issueIdOrKey}/worklog with
// `timeSpentSeconds` + ISO date.
//
// `projectId` in this contract maps to Jira's PROJECT KEY (e.g. "TF") —
// the human-readable identifier; tasks list via `jql=project=KEY`.
public sealed class JiraAdapter : IProjectIntegration {
    public string Provider => IntegrationProviders.Jira;
    private readonly HttpClient _http;
    public JiraAdapter(HttpClient http) { _http = http; }

    public async Task<IntegrationVerifyResult> VerifyAsync(IntegrationCredentials creds, CancellationToken ct = default) {
        var c = (JiraCredentials)creds;
        var req = HttpHelpers.Json(HttpMethod.Get, $"{c.BaseUrl.TrimEnd('/')}/rest/api/3/myself");
        AddAuth(req, c.Email, c.Token);
        var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
        return new IntegrationVerifyResult(
            Ok: true,
            UserId: json.TryGet("accountId")?.GetString(),
            UserName: json.TryGet("displayName")?.GetString(),
            UserEmail: json.TryGet("emailAddress")?.GetString());
    }

    public async IAsyncEnumerable<IntegrationProject> ListProjectsAsync(
        IntegrationCredentials creds, int maxItems = 100, [EnumeratorCancellation] CancellationToken ct = default) {
        var c = (JiraCredentials)creds;
        var req = HttpHelpers.Json(HttpMethod.Get,
            $"{c.BaseUrl.TrimEnd('/')}/rest/api/3/project/search?maxResults={Math.Min(maxItems, 100)}");
        AddAuth(req, c.Email, c.Token);
        var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);

        var values = json.GetProperty("values");
        var n = 0;
        foreach (var p in values.EnumerateArray()) {
            if (n++ >= maxItems) yield break;
            yield return new IntegrationProject(
                Id: p.GetProperty("key").GetString() ?? p.GetProperty("id").GetString()!,
                Name: p.TryGet("name")?.GetString() ?? "",
                Code: p.TryGet("key")?.GetString(),
                Active: !(p.TryGet("archived")?.GetBoolean() ?? false),
                Raw: p.GetRawText());
        }
    }

    public async IAsyncEnumerable<IntegrationTask> ListTasksAsync(
        IntegrationCredentials creds, string projectId, int maxItems = 200, DateTime? since = null,
        string? assigneeUpstreamId = null,
        [EnumeratorCancellation] CancellationToken ct = default) {
        // `since` + `assigneeUpstreamId` ignored — Jira supports both via
        // JQL (`updated > "..."` + `assignee = X`) but no production Jira
        // connection exists yet, defer until needed.
        _ = since;
        _ = assigneeUpstreamId;
        var c = (JiraCredentials)creds;
        var jql = Uri.EscapeDataString($"project = \"{projectId}\" ORDER BY updated DESC");
        var fields = "summary,status,assignee,updated";
        var req = HttpHelpers.Json(HttpMethod.Get,
            $"{c.BaseUrl.TrimEnd('/')}/rest/api/3/search?jql={jql}&fields={fields}&maxResults={Math.Min(maxItems, 100)}");
        AddAuth(req, c.Email, c.Token);
        var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);

        var issues = json.GetProperty("issues");
        var n = 0;
        foreach (var i in issues.EnumerateArray()) {
            if (n++ >= maxItems) yield break;
            yield return MapIssue(i, projectId);
        }
    }

    public async Task<IntegrationTask?> GetTaskAsync(IntegrationCredentials creds, string taskId, CancellationToken ct = default) {
        var c = (JiraCredentials)creds;
        var req = HttpHelpers.Json(HttpMethod.Get, $"{c.BaseUrl.TrimEnd('/')}/rest/api/3/issue/{taskId}");
        AddAuth(req, c.Email, c.Token);
        try {
            var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
            var projectKey = json.TryGet("fields")?.TryGet("project")?.TryGet("key")?.GetString() ?? "";
            return MapIssue(json, projectKey);
        } catch (UpstreamIntegrationException ex) when (ex.Status is System.Net.HttpStatusCode.NotFound) {
            return null;
        }
    }

    public Task<IntegrationTask> CreateTaskAsync(
        IntegrationCredentials creds, string projectId, IntegrationTaskCreateInput input,
        CancellationToken ct = default) =>
        throw new NotSupportedException("Jira task creation is not supported in this build.");

    public Task<IntegrationTask> UpdateTaskAsync(
        IntegrationCredentials creds, string taskId, IntegrationTaskUpdateInput input,
        CancellationToken ct = default) =>
        throw new NotSupportedException("Jira task editing is not supported in this build.");

    public async IAsyncEnumerable<IntegrationWorklogEntry> ListWorklogsAsync(
        IntegrationCredentials creds, DateOnly from, DateOnly to, string? upstreamUserId,
        [EnumeratorCancellation] CancellationToken ct = default) {
        // Phase 2 — Jira's /worklog API is per-issue (no global "my worklogs"
        // list), so a full pull would require iterating every visible issue.
        // Defer until a customer actually needs it.
        await Task.CompletedTask;
        yield break;
    }

    public async Task<IntegrationWorklogResult> PostWorklogAsync(
        IntegrationCredentials creds, string taskId, decimal hours, DateOnly date, string? comment,
        CancellationToken ct = default) {
        var c = (JiraCredentials)creds;
        var body = new {
            timeSpentSeconds = (int)Math.Round(hours * 3600m, MidpointRounding.AwayFromZero),
            // Jira accepts ISO 8601 with offset; build a noon-UTC stamp so a
            // user in any TZ lands on the day they meant.
            started = $"{date:yyyy-MM-dd}T12:00:00.000+0000",
            comment = string.IsNullOrEmpty(comment) ? null : new {
                type = "doc",
                version = 1,
                content = new[] { new {
                    type = "paragraph",
                    content = new[] { new { type = "text", text = comment } },
                } },
            },
        };
        var req = HttpHelpers.Json(HttpMethod.Post,
            $"{c.BaseUrl.TrimEnd('/')}/rest/api/3/issue/{taskId}/worklog", body);
        AddAuth(req, c.Email, c.Token);
        var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
        return new IntegrationWorklogResult(
            UpstreamId: json.GetProperty("id").GetString() ?? "",
            TaskId: taskId,
            Hours: hours,
            Date: date);
    }

    private static void AddAuth(HttpRequestMessage req, string email, string token) {
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{email}:{token}"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", encoded);
    }

    private static IntegrationTask MapIssue(JsonElement issue, string projectId) {
        var fields = issue.TryGet("fields");
        var status = fields?.TryGet("status")?.TryGet("name")?.GetString() ?? "unknown";
        var assigneeId = fields?.TryGet("assignee")?.TryGet("accountId")?.GetString();
        var updated = HttpHelpers.ParseUpstreamUtc(fields?.TryGet("updated")?.GetString());
        return new IntegrationTask(
            Id: issue.GetProperty("key").GetString() ?? issue.GetProperty("id").GetString()!,
            ProjectId: projectId,
            Title: fields?.TryGet("summary")?.GetString() ?? "",
            Status: status,
            AssigneeId: assigneeId,
            UpdatedAt: updated,
            Raw: issue.GetRawText());
    }
}
