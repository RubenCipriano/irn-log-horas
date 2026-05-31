using System.Runtime.CompilerServices;

namespace TimeFlow.Ai.Providers;

// Reads a `text/event-stream` body line-by-line. Both Anthropic and
// OpenAI ship SSE, and both use the standard `event:` + `data:` shape;
// they just disagree on which event names carry what payload, so we
// keep the parser dumb and let each adapter switch on event name.
//
// Yields raw (event, data) tuples; adapters JSON-parse the data. Empty
// data lines and comments (lines starting with `:`) are skipped.
internal static class SseLineReader {
    public static async IAsyncEnumerable<(string Event, string Data)> ReadAsync(
        Stream stream,
        [EnumeratorCancellation] CancellationToken ct = default) {
        using var reader = new StreamReader(stream);
        string? eventName = null;
        var dataBuf = new System.Text.StringBuilder();

        while (!ct.IsCancellationRequested) {
            var line = await reader.ReadLineAsync(ct);
            if (line is null) {
                // End of stream — flush whatever's pending.
                if (dataBuf.Length > 0) {
                    yield return (eventName ?? "message", dataBuf.ToString());
                }
                yield break;
            }
            if (line.Length == 0) {
                // Blank line = dispatch the accumulated event.
                if (dataBuf.Length > 0) {
                    yield return (eventName ?? "message", dataBuf.ToString());
                }
                eventName = null;
                dataBuf.Clear();
                continue;
            }
            if (line[0] == ':') continue; // comment / heartbeat
            if (line.StartsWith("event:", StringComparison.Ordinal)) {
                eventName = line.AsSpan(6).TrimStart().ToString();
            } else if (line.StartsWith("data:", StringComparison.Ordinal)) {
                if (dataBuf.Length > 0) dataBuf.Append('\n');
                dataBuf.Append(line.AsSpan(5).TrimStart());
            }
            // Any other field (id:, retry:) — we ignore.
        }
    }
}
