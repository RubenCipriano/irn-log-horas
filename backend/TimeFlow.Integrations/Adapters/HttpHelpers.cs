using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using TimeFlow.Integrations.Contract;

namespace TimeFlow.Integrations.Adapters;

// Shared HTTP plumbing so each adapter only spells out what's
// provider-specific (auth header style, URL paths, response shapes).
//
// `SendJsonAsync<T>` runs the request, normalises non-2xx into
// UpstreamIntegrationException, and reads JSON into T using Web defaults
// (camelCase). Returns the response so adapters can also peek at
// headers (e.g. GitLab's `X-Next-Page` for pagination cursors).
internal static class HttpHelpers {
    public static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    public static async Task<T> SendJsonAsync<T>(
        this HttpClient http,
        HttpRequestMessage req,
        string provider,
        CancellationToken ct) {
        HttpResponseMessage resp;
        try {
            resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        } catch (HttpRequestException ex) {
            throw new UpstreamIntegrationException(
                provider, UpstreamErrorClass.Network,
                "Couldn't reach upstream.", null, null, ex);
        } catch (TaskCanceledException ex) when (!ct.IsCancellationRequested) {
            // Timeout — TaskCanceledException is what HttpClient throws when
            // its own timeout fires (separate from caller's cancellation).
            throw new UpstreamIntegrationException(
                provider, UpstreamErrorClass.Network,
                "Upstream timeout.", null, null, ex);
        }

        await using var stream = await resp.Content.ReadAsStreamAsync(ct);
        if (!resp.IsSuccessStatusCode) {
            // Read the body for our server logs only — the API layer never
            // echoes it back to the user.
            using var ms = new MemoryStream();
            await stream.CopyToAsync(ms, ct);
            var body = Encoding.UTF8.GetString(ms.ToArray());
            throw UpstreamIntegrationException.FromStatus(provider, resp.StatusCode, body);
        }

        try {
            var result = await JsonSerializer.DeserializeAsync<T>(stream, JsonOpts, ct);
            return result ?? throw new UpstreamIntegrationException(
                provider, UpstreamErrorClass.Generic, "Upstream returned empty body.", resp.StatusCode);
        } catch (JsonException ex) {
            throw new UpstreamIntegrationException(
                provider, UpstreamErrorClass.Generic,
                "Upstream returned unexpected JSON.", resp.StatusCode, null, ex);
        }
    }

    public static HttpRequestMessage Json(HttpMethod method, string url, object? body = null) {
        var req = new HttpRequestMessage(method, url);
        // SSRF guard: validate the absolute target host before the request is
        // ever dispatched. Adapters build `url` from a user-supplied BaseUrl;
        // without this an attacker could aim a connection at cloud-metadata or
        // an internal host. Relative URLs (none today) and unparseable input
        // are caught by Validate(string). The `provider` for the typed
        // exception is unknown here, so it surfaces as the generic upstream
        // key — the message is bucketed identically regardless.
        SafeUpstreamUri.Validate(url, "upstream");
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (body is not null) {
            req.Content = JsonContent.Create(body, options: JsonOpts);
        }
        return req;
    }

    /// <summary>
    /// Parse an upstream timestamp into a UTC DateTime. Upstreams return
    /// ISO-8601 with offsets (e.g. `2026-05-27T10:00:00+01:00`); naive
    /// <see cref="DateTime.TryParse(string, out DateTime)"/> returns
    /// `Kind=Local`, which Postgres' `timestamptz` columns refuse via
    /// Npgsql (it requires UTC). `AdjustToUniversal | AssumeUniversal`
    /// forces both offset-bearing and naive strings to land as UTC.
    /// </summary>
    public static DateTime? ParseUpstreamUtc(string? raw) {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (DateTime.TryParse(
                raw, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                out var parsed)) {
            return parsed;
        }
        return null;
    }
}
