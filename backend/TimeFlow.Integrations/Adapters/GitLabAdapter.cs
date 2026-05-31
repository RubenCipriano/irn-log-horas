using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TimeFlow.Integrations.Contract;

namespace TimeFlow.Integrations.Adapters;

// GitLab (REST API v4). Auth: `PRIVATE-TOKEN: <token>` header.
// Pagination: `per_page` + `page`; the `X-Total-Pages` header tells us
// how many remain but we cap at maxItems.
//
// Our "task" → GitLab issue. Worklogs aren't a first-class concept;
// the legacy stack used `/notes` (issue comments) the same way. GitLab
// DOES expose `/issues/:iid/add_spent_time` which we use here — it
// updates the "time spent" tally without polluting the comment stream.
public sealed class GitLabAdapter : IProjectIntegration {
    public string Provider => IntegrationProviders.GitLab;
    private readonly HttpClient _http;
    public GitLabAdapter(HttpClient http) { _http = http; }

    public async Task<IntegrationVerifyResult> VerifyAsync(IntegrationCredentials creds, CancellationToken ct = default) {
        var c = (GitLabCredentials)creds;
        var req = HttpHelpers.Json(HttpMethod.Get, $"{c.BaseUrl.TrimEnd('/')}/api/v4/user");
        AddAuth(req, c.Token);
        var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
        return new IntegrationVerifyResult(
            Ok: true,
            UserId: json.TryGet("id")?.ToString(),
            UserName: json.TryGet("name")?.GetString(),
            UserEmail: json.TryGet("email")?.GetString());
    }

    public async IAsyncEnumerable<IntegrationProject> ListProjectsAsync(
        IntegrationCredentials creds, int maxItems = 100, [EnumeratorCancellation] CancellationToken ct = default) {
        var c = (GitLabCredentials)creds;
        var perPage = Math.Min(maxItems, 100);
        var req = HttpHelpers.Json(HttpMethod.Get,
            $"{c.BaseUrl.TrimEnd('/')}/api/v4/projects?membership=true&order_by=last_activity_at&per_page={perPage}");
        AddAuth(req, c.Token);
        var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
        var n = 0;
        foreach (var p in json.EnumerateArray()) {
            if (n++ >= maxItems) yield break;
            yield return new IntegrationProject(
                Id: p.GetProperty("id").ToString(),
                Name: p.TryGet("name_with_namespace")?.GetString() ?? p.GetProperty("name").GetString()!,
                Code: p.TryGet("path_with_namespace")?.GetString(),
                Active: !(p.TryGet("archived")?.GetBoolean() ?? false),
                Raw: p.GetRawText());
        }
    }

    public async IAsyncEnumerable<IntegrationTask> ListTasksAsync(
        IntegrationCredentials creds, string projectId, int maxItems = 200, DateTime? since = null,
        string? assigneeUpstreamId = null,
        [EnumeratorCancellation] CancellationToken ct = default) {
        // `since` + `assigneeUpstreamId` ignored — GitLab issues support both
        // (`updated_after=ISO8601`, `assignee_id=<id>`) but no production
        // GitLab connection exists yet, defer until needed.
        _ = since;
        _ = assigneeUpstreamId;
        var c = (GitLabCredentials)creds;
        var perPage = Math.Min(maxItems, 100);
        var req = HttpHelpers.Json(HttpMethod.Get,
            $"{c.BaseUrl.TrimEnd('/')}/api/v4/projects/{projectId}/issues?per_page={perPage}&order_by=updated_at");
        AddAuth(req, c.Token);
        var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
        var n = 0;
        foreach (var i in json.EnumerateArray()) {
            if (n++ >= maxItems) yield break;
            yield return MapIssue(i, projectId);
        }
    }

    public async Task<IntegrationTask?> GetTaskAsync(IntegrationCredentials creds, string taskId, CancellationToken ct = default) {
        var c = (GitLabCredentials)creds;
        // `taskId` here is "{projectId}:{iid}" so we can hit the per-project
        // endpoint. Linear / OpenProject return a single global id; GitLab
        // doesn't — issues are scoped per project.
        var parts = taskId.Split(':');
        if (parts.Length != 2) {
            throw new ArgumentException("GitLab task ids are formatted as `{projectId}:{issueIid}`.", nameof(taskId));
        }
        var req = HttpHelpers.Json(HttpMethod.Get,
            $"{c.BaseUrl.TrimEnd('/')}/api/v4/projects/{parts[0]}/issues/{parts[1]}");
        AddAuth(req, c.Token);
        try {
            var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
            return MapIssue(json, parts[0]);
        } catch (UpstreamIntegrationException ex) when (ex.Status is System.Net.HttpStatusCode.NotFound) {
            return null;
        }
    }

    public Task<IntegrationTask> CreateTaskAsync(
        IntegrationCredentials creds, string projectId, IntegrationTaskCreateInput input,
        CancellationToken ct = default) =>
        throw new NotSupportedException("GitLab issue creation is not supported in this build.");

    public Task<IntegrationTask> UpdateTaskAsync(
        IntegrationCredentials creds, string taskId, IntegrationTaskUpdateInput input,
        CancellationToken ct = default) =>
        throw new NotSupportedException("GitLab issue editing is not supported in this build.");

    public async IAsyncEnumerable<IntegrationWorklogEntry> ListWorklogsAsync(
        IntegrationCredentials creds, DateOnly from, DateOnly to, string? upstreamUserId,
        [EnumeratorCancellation] CancellationToken ct = default) {
        // Phase 2 — GitLab's time_stats is per-issue (no global list), same
        // problem as Jira. Defer until needed.
        await Task.CompletedTask;
        yield break;
    }

    public async Task<IntegrationWorklogResult> PostWorklogAsync(
        IntegrationCredentials creds, string taskId, decimal hours, DateOnly date, string? comment,
        CancellationToken ct = default) {
        var c = (GitLabCredentials)creds;
        var parts = taskId.Split(':');
        if (parts.Length != 2) {
            throw new ArgumentException("GitLab task ids are formatted as `{projectId}:{issueIid}`.", nameof(taskId));
        }
        // Use the time-spent endpoint with a human-readable duration. GitLab
        // accepts "Xh Ym" and tracks the per-day attribution under the hood.
        var duration = ToGitlabDuration(hours);
        var url = $"{c.BaseUrl.TrimEnd('/')}/api/v4/projects/{parts[0]}/issues/{parts[1]}/add_spent_time?duration={Uri.EscapeDataString(duration)}&summary={Uri.EscapeDataString(comment ?? $"TimeFlow {date:yyyy-MM-dd}")}";
        var req = HttpHelpers.Json(HttpMethod.Post, url);
        AddAuth(req, c.Token);
        var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
        // GitLab returns the issue back; we synthesise the worklog id from
        // (issue iid, date) since there's no separate row identifier.
        return new IntegrationWorklogResult(
            UpstreamId: $"{taskId}@{date:yyyy-MM-dd}",
            TaskId: taskId,
            Hours: hours,
            Date: date);
    }

    private static void AddAuth(HttpRequestMessage req, string token) {
        req.Headers.Add("PRIVATE-TOKEN", token);
    }

    private static IntegrationTask MapIssue(JsonElement i, string projectId) {
        var status = i.TryGet("state")?.GetString() ?? "unknown"; // "opened" | "closed"
        var assigneeId = i.TryGet("assignee")?.TryGet("id")?.ToString();
        var updated = HttpHelpers.ParseUpstreamUtc(i.TryGet("updated_at")?.GetString());
        var iid = i.TryGet("iid")?.ToString() ?? i.GetProperty("id").ToString();
        return new IntegrationTask(
            Id: $"{projectId}:{iid}",
            ProjectId: projectId,
            Title: i.TryGet("title")?.GetString() ?? "",
            Status: status,
            AssigneeId: assigneeId,
            UpdatedAt: updated,
            Raw: i.GetRawText());
    }

    private static string ToGitlabDuration(decimal hours) {
        var totalMinutes = (int)Math.Round(hours * 60m, MidpointRounding.AwayFromZero);
        var h = totalMinutes / 60;
        var m = totalMinutes % 60;
        if (h == 0 && m == 0) return "0m";
        if (m == 0) return $"{h}h";
        if (h == 0) return $"{m}m";
        return $"{h}h {m}m";
    }
}
