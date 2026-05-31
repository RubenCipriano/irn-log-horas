using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using TimeFlow.Integrations.Contract;

namespace TimeFlow.Integrations.Adapters;

// OpenProject API v3. Auth: Basic with `apikey:<token>`. Pagination:
// HAL+JSON `pageSize`/`offset`. URL shape: `{baseUrl}/api/v3/...`.
//
// We hit:
//   * GET /api/v3/users/me                                 (verify)
//   * GET /api/v3/projects?pageSize=N                      (projects)
//   * GET /api/v3/work_packages?filters=[…]&pageSize=N     (tasks)
//   * GET /api/v3/work_packages/{id}                       (one task)
//   * POST /api/v3/work_packages/{id}/activities …time_entry  (worklog)
//
// Body shapes are kept as `JsonElement` so we never have to chase
// upstream schema changes in C# records; we project the fields we care
// about and pass the raw blob through to callers that want more.
public sealed class OpenProjectAdapter : IProjectIntegration {
    public string Provider => IntegrationProviders.OpenProject;
    private readonly HttpClient _http;
    public OpenProjectAdapter(HttpClient http) { _http = http; }

    public async Task<IntegrationVerifyResult> VerifyAsync(IntegrationCredentials creds, CancellationToken ct = default) {
        var c = (OpenProjectCredentials)creds;
        var req = HttpHelpers.Json(HttpMethod.Get, $"{c.BaseUrl.TrimEnd('/')}/api/v3/users/me");
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
        var c = (OpenProjectCredentials)creds;
        var n = 0;
        await foreach (var p in PaginateAsync(c, "api/v3/projects", null, ct)) {
            if (n++ >= maxItems) yield break;
            yield return new IntegrationProject(
                Id: p.GetProperty("id").ToString(),
                Name: p.GetProperty("name").GetString() ?? "",
                Code: p.TryGet("identifier")?.GetString(),
                Active: p.TryGet("active")?.GetBoolean() ?? true,
                Raw: p.GetRawText());
        }
    }

    public async IAsyncEnumerable<IntegrationTask> ListTasksAsync(
        IntegrationCredentials creds, string projectId, int maxItems = 200, DateTime? since = null,
        string? assigneeUpstreamId = null,
        [EnumeratorCancellation] CancellationToken ct = default) {
        var c = (OpenProjectCredentials)creds;
        // OpenProject's filter syntax is JSON in the URL — gnarly but stable.
        // When `since` is set we add an `updatedAt > since` clause using the
        // same `>d` operator OpenProject accepts for date comparisons. This
        // is what makes a re-sync a delta pull instead of a full refetch.
        // When `assigneeUpstreamId` is set we tack on an `assignee = X`
        // filter — per-user connections use this to skip the long tail of
        // tasks owned by other people.
        var filterParts = new List<string> {
            $"{{\"project\":{{\"operator\":\"=\",\"values\":[\"{projectId}\"]}}}}",
        };
        if (since is DateTime s) {
            var iso = s.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ");
            filterParts.Add($"{{\"updatedAt\":{{\"operator\":\">d\",\"values\":[\"{iso}\"]}}}}");
        }
        if (!string.IsNullOrEmpty(assigneeUpstreamId)) {
            filterParts.Add($"{{\"assignee\":{{\"operator\":\"=\",\"values\":[\"{assigneeUpstreamId}\"]}}}}");
        }
        var filters = Uri.EscapeDataString("[" + string.Join(',', filterParts) + "]");
        var n = 0;
        await foreach (var wp in PaginateAsync(c, "api/v3/work_packages", $"filters={filters}", ct)) {
            if (n++ >= maxItems) yield break;
            yield return MapWorkPackage(wp, projectId);
        }
    }

    public async Task<IntegrationTask?> GetTaskAsync(IntegrationCredentials creds, string taskId, CancellationToken ct = default) {
        var c = (OpenProjectCredentials)creds;
        var req = HttpHelpers.Json(HttpMethod.Get, $"{c.BaseUrl.TrimEnd('/')}/api/v3/work_packages/{taskId}");
        AddAuth(req, c.Token);
        try {
            var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
            return MapWorkPackage(json, projectId: ResolveProjectId(json));
        } catch (UpstreamIntegrationException ex) when (ex.Status is System.Net.HttpStatusCode.NotFound) {
            return null;
        }
    }

    public async Task<IntegrationTask> CreateTaskAsync(
        IntegrationCredentials creds, string projectId, IntegrationTaskCreateInput input,
        CancellationToken ct = default) {
        var c = (OpenProjectCredentials)creds;
        // OpenProject requires `_links.type.href` on create. Resolve once
        // per-project here: GET the project's types, pick the first.
        // Single round trip + tiny payload, no caching needed for ad-hoc
        // creates triggered from a manager's task page.
        var typeReq = HttpHelpers.Json(HttpMethod.Get,
            $"{c.BaseUrl.TrimEnd('/')}/api/v3/projects/{projectId}/types?pageSize=1");
        AddAuth(typeReq, c.Token);
        var typesJson = await _http.SendJsonAsync<JsonElement>(typeReq, Provider, ct);
        var firstType = typesJson.GetProperty("_embedded").GetProperty("elements").EnumerateArray().FirstOrDefault();
        if (firstType.ValueKind == JsonValueKind.Undefined) {
            throw new InvalidOperationException("OpenProject project has no work-package types.");
        }
        var typeHref = firstType.GetProperty("_links").GetProperty("self").GetProperty("href").GetString()!;

        var links = BuildLinks(projectId, typeHref, input.Status, input.AssigneeId, input.VersionId);
        var body = BuildWorkPackageBody(input.Title, input.Description, lockVersion: null, links);

        var req = HttpHelpers.Json(HttpMethod.Post,
            $"{c.BaseUrl.TrimEnd('/')}/api/v3/work_packages", body);
        AddAuth(req, c.Token);
        var created = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
        return MapWorkPackage(created, projectId);
    }

    public async Task<IntegrationTask> UpdateTaskAsync(
        IntegrationCredentials creds, string taskId, IntegrationTaskUpdateInput input,
        CancellationToken ct = default) {
        var c = (OpenProjectCredentials)creds;
        // OpenProject uses optimistic concurrency: every PATCH must echo
        // back the current `lockVersion`. Fetch first to read it.
        var getReq = HttpHelpers.Json(HttpMethod.Get,
            $"{c.BaseUrl.TrimEnd('/')}/api/v3/work_packages/{taskId}");
        AddAuth(getReq, c.Token);
        var current = await _http.SendJsonAsync<JsonElement>(getReq, Provider, ct);
        var lockVersion = current.TryGet("lockVersion")?.GetInt32() ?? 0;
        var projectId = ResolveProjectId(current);

        var links = BuildLinks(
            projectId: null,
            typeHref: null,
            status: input.Status,
            assigneeId: input.AssigneeId,
            versionId: input.VersionId);
        var body = BuildWorkPackageBody(input.Title, input.Description, lockVersion: lockVersion, links);

        var req = HttpHelpers.Json(HttpMethod.Patch,
            $"{c.BaseUrl.TrimEnd('/')}/api/v3/work_packages/{taskId}", body);
        AddAuth(req, c.Token);
        var updated = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
        return MapWorkPackage(updated, projectId);
    }

    // Constructs the `_links` object using OP's `/api/v3/<resource>/<id>`
    // href shape. Null inputs are skipped so PATCHes only touch the fields
    // the caller actually changed.
    private static Dictionary<string, object> BuildLinks(
        string? projectId, string? typeHref,
        string? status, string? assigneeId, string? versionId) {
        var links = new Dictionary<string, object>();
        if (projectId is not null) {
            links["project"] = new { href = $"/api/v3/projects/{projectId}" };
        }
        if (typeHref is not null) {
            links["type"] = new { href = typeHref };
        }
        if (status is not null) {
            links["status"] = new { href = $"/api/v3/statuses/{status}" };
        }
        if (assigneeId is not null) {
            links["assignee"] = new { href = $"/api/v3/users/{assigneeId}" };
        }
        if (versionId is not null) {
            links["version"] = new { href = $"/api/v3/versions/{versionId}" };
        }
        return links;
    }

    private static object BuildWorkPackageBody(
        string? subject, string? description, int? lockVersion, Dictionary<string, object> links) {
        // JsonElement-friendly anonymous-style body. We only emit fields
        // the caller set; OP rejects unknown keys but accepts missing ones.
        var body = new Dictionary<string, object?>();
        if (subject is not null) body["subject"] = subject;
        if (description is not null) {
            body["description"] = new { format = "plain", raw = description };
        }
        if (lockVersion is not null) body["lockVersion"] = lockVersion;
        if (links.Count > 0) body["_links"] = links;
        return body;
    }

    public async IAsyncEnumerable<IntegrationWorklogEntry> ListWorklogsAsync(
        IntegrationCredentials creds, DateOnly from, DateOnly to, string? upstreamUserId,
        [EnumeratorCancellation] CancellationToken ct = default) {
        var c = (OpenProjectCredentials)creds;
        // OpenProject's date-range filter operator is "<>d" with [from, to].
        // Stack a user-id filter when the connection knows its own id so
        // we don't pull other people's hours into the calling user's row.
        var fromIso = from.ToString("yyyy-MM-dd");
        var toIso = to.ToString("yyyy-MM-dd");
        var filterParts = new List<string> {
            $"{{\"spentOn\":{{\"operator\":\"<>d\",\"values\":[\"{fromIso}\",\"{toIso}\"]}}}}",
        };
        if (!string.IsNullOrEmpty(upstreamUserId)) {
            filterParts.Add($"{{\"user\":{{\"operator\":\"=\",\"values\":[\"{upstreamUserId}\"]}}}}");
        }
        var filters = Uri.EscapeDataString("[" + string.Join(',', filterParts) + "]");

        await foreach (var te in PaginateAsync(c, "api/v3/time_entries", $"filters={filters}", ct)) {
            var entry = MapTimeEntry(te);
            if (entry is not null) yield return entry;
        }
    }

    // Walks every page of a HAL-paginated OpenProject endpoint, yielding
    // each `_embedded.elements[]` row across pages. Termination matches
    // the existing ListWorklogsAsync loop: a short page means we hit the
    // end. We deliberately don't follow `_links.nextByOffset.href` —
    // the count-based termination reads cleaner and is what the prior
    // worklog loop relied on without issue.
    private async IAsyncEnumerable<JsonElement> PaginateAsync(
        OpenProjectCredentials c,
        string path,
        string? extraQuery,
        [EnumeratorCancellation] CancellationToken ct,
        int pageSize = 200) {
        var offset = 1;
        while (true) {
            var sep = string.IsNullOrEmpty(extraQuery) ? "" : extraQuery + "&";
            var url = $"{c.BaseUrl.TrimEnd('/')}/{path}?{sep}pageSize={pageSize}&offset={offset}";
            var req = HttpHelpers.Json(HttpMethod.Get, url);
            AddAuth(req, c.Token);
            var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
            var elements = json.GetProperty("_embedded").GetProperty("elements");
            var count = 0;
            foreach (var el in elements.EnumerateArray()) {
                count++;
                yield return el;
            }
            if (count < pageSize) yield break;
            offset++;
        }
    }

    public async Task<IntegrationWorklogResult> PostWorklogAsync(
        IntegrationCredentials creds, string taskId, decimal hours, DateOnly date, string? comment,
        CancellationToken ct = default) {
        var c = (OpenProjectCredentials)creds;
        // OpenProject expects ISO 8601 duration ("PT4H30M") on time_entries.
        var iso = ToIso8601Duration(hours);
        var body = new {
            _links = new {
                workPackage = new { href = $"/api/v3/work_packages/{taskId}" },
            },
            spentOn = date.ToString("yyyy-MM-dd"),
            hours = iso,
            comment = string.IsNullOrEmpty(comment) ? null : new { format = "plain", raw = comment },
        };
        var req = HttpHelpers.Json(HttpMethod.Post,
            $"{c.BaseUrl.TrimEnd('/')}/api/v3/time_entries", body);
        AddAuth(req, c.Token);
        var json = await _http.SendJsonAsync<JsonElement>(req, Provider, ct);
        return new IntegrationWorklogResult(
            UpstreamId: json.GetProperty("id").ToString(),
            TaskId: taskId,
            Hours: hours,
            Date: date);
    }

    private static void AddAuth(HttpRequestMessage req, string token) {
        // OpenProject uses Basic with literal `apikey:<token>`.
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes($"apikey:{token}"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", encoded);
    }

    private static IntegrationTask MapWorkPackage(JsonElement wp, string projectId) {
        var links = wp.TryGet("_links");
        var status = links?.TryGet("status")?.TryGet("title")?.GetString() ?? "unknown";
        var assignee = links?.TryGet("assignee")?.TryGet("href")?.GetString();
        var updated = HttpHelpers.ParseUpstreamUtc(wp.TryGet("updatedAt")?.GetString());
        // `_links.version.href` = "/api/v3/versions/{id}" when the work
        // package is in a sprint; `title` carries the human label. Both
        // null if unassigned (`href` will be null OR equal to the empty
        // /versions root — Split('/').Last() handles both cleanly).
        var versionLink = links?.TryGet("version");
        var versionHref = versionLink?.TryGet("href")?.GetString();
        var versionId = string.IsNullOrEmpty(versionHref) ? null : versionHref.Split('/').Last();
        if (versionId == "versions") versionId = null; // empty link shape
        var versionName = versionLink?.TryGet("title")?.GetString();
        return new IntegrationTask(
            Id: wp.GetProperty("id").ToString(),
            ProjectId: projectId,
            Title: wp.TryGet("subject")?.GetString() ?? "",
            Status: status,
            AssigneeId: assignee?.Split('/').Last(),
            UpdatedAt: updated,
            Raw: wp.GetRawText(),
            VersionId: versionId,
            VersionName: versionName);
    }

    private static string ResolveProjectId(JsonElement wp) {
        // Extract from `_links.project.href` = "/api/v3/projects/{id}".
        var href = wp.TryGet("_links")?.TryGet("project")?.TryGet("href")?.GetString();
        return href?.Split('/').Last() ?? "";
    }

    private static string ToIso8601Duration(decimal hours) {
        var totalMinutes = (int)Math.Round(hours * 60m, MidpointRounding.AwayFromZero);
        var h = totalMinutes / 60;
        var m = totalMinutes % 60;
        if (h == 0 && m == 0) return "PT0M";
        var sb = new StringBuilder("PT");
        if (h > 0) sb.Append($"{h}H");
        if (m > 0) sb.Append($"{m}M");
        return sb.ToString();
    }

    private static readonly System.Text.RegularExpressions.Regex IsoDurationRx =
        new(@"^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$",
            System.Text.RegularExpressions.RegexOptions.Compiled);

    private static decimal FromIso8601Duration(string? iso) {
        // Inverse of ToIso8601Duration — but accepts seconds too because
        // some OpenProject installs emit `PT3600S` for an hour. Returns
        // 0 on any parse failure so a bad value never poisons the import.
        if (string.IsNullOrWhiteSpace(iso)) return 0m;
        var m = IsoDurationRx.Match(iso);
        if (!m.Success) return 0m;
        decimal Parse(int g) => m.Groups[g].Success
            ? decimal.Parse(m.Groups[g].Value, System.Globalization.CultureInfo.InvariantCulture)
            : 0m;
        return Parse(1) + (Parse(2) / 60m) + (Parse(3) / 3600m);
    }

    private static IntegrationWorklogEntry? MapTimeEntry(JsonElement te) {
        // Skip entries that don't have a work_package — OpenProject can
        // have project-level time entries (no WP) which we can't map to
        // an UpstreamTask, so they're useless to the calendar.
        var links = te.TryGet("_links");
        var wpHref = links?.TryGet("workPackage")?.TryGet("href")?.GetString();
        var taskId = wpHref?.Split('/').Last();
        if (string.IsNullOrEmpty(taskId)) return null;

        var userHref = links?.TryGet("user")?.TryGet("href")?.GetString();
        var userId = userHref?.Split('/').Last();
        var spentOn = te.TryGet("spentOn")?.GetString();
        if (!DateOnly.TryParse(spentOn, System.Globalization.CultureInfo.InvariantCulture, out var date)) {
            return null;
        }
        var hours = FromIso8601Duration(te.TryGet("hours")?.GetString());
        // `comment.raw` carries the user's note. Some installs nest it
        // under a different key, fall back to the top-level string form.
        var comment = te.TryGet("comment")?.TryGet("raw")?.GetString();

        return new IntegrationWorklogEntry(
            UpstreamId: te.GetProperty("id").ToString(),
            TaskUpstreamId: taskId,
            UserUpstreamId: userId,
            WorkDate: date,
            Hours: hours,
            Comment: comment);
    }
}

internal static class JsonElementHelpers {
    public static JsonElement? TryGet(this JsonElement self, string name) =>
        self.ValueKind == JsonValueKind.Object && self.TryGetProperty(name, out var v) ? v : null;
}
