using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TimeFlow.Api.Services;

// Tiny SSE helper used by the AI streaming endpoints. Converts an
// IAsyncEnumerable<T> into `text/event-stream` chunks written to the
// response body, one JSON-serialised payload per event.
//
// Per the SSE spec, each event is:
//
//   event: <name>
//   data: <single-line json>
//   <blank line>
//
// We flush after each event so the SPA's EventSource gets the chunk in
// real time, not in a buffered burst at the end.
public static class ServerSentEvents {
    // Web defaults + string enums (so the SPA gets `"kind":"delta"`,
    // `"done"`, `"error"` instead of opaque integers). camelCase comes
    // from JsonNamingPolicy.CamelCase used by the converter.
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web) {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    /// <summary>
    /// Set the right SSE response headers + stream events. <paramref name="eventName"/>
    /// is the value attached to every event (the consumer dispatches on it).
    /// </summary>
    public static async Task WriteStreamAsync<T>(
        this HttpResponse response,
        IAsyncEnumerable<T> source,
        string eventName,
        CancellationToken ct = default) {
        response.StatusCode = 200;
        response.Headers["Content-Type"] = "text/event-stream";
        response.Headers["Cache-Control"] = "no-cache, no-transform";
        // Disable any reverse-proxy buffering — important when nginx is
        // in front of the backend in production.
        response.Headers["X-Accel-Buffering"] = "no";

        try {
            await foreach (var item in source.WithCancellation(ct)) {
                var line = "event: " + eventName + "\n" +
                    "data: " + JsonSerializer.Serialize(item, JsonOpts) + "\n\n";
                var bytes = Encoding.UTF8.GetBytes(line);
                await response.Body.WriteAsync(bytes, ct);
                await response.Body.FlushAsync(ct);
            }
        } catch (OperationCanceledException) {
            // Client disconnected — let the request unwind cleanly.
        }

        // Polite stream close marker. Standard SSE clients ignore unknown
        // events; consumers that care can listen for `done`.
        var closeBytes = Encoding.UTF8.GetBytes("event: close\ndata: {}\n\n");
        try {
            await response.Body.WriteAsync(closeBytes, ct);
            await response.Body.FlushAsync(ct);
        } catch (OperationCanceledException) { /* already gone */ }
    }
}
