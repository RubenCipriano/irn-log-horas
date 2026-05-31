using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TimeFlow.Ai.Contract;

namespace TimeFlow.Ai.Providers;

// Claude Messages API (https://api.anthropic.com/v1/messages). Auth via
// `x-api-key`. SSE events of interest:
//   * content_block_delta  → delta.text
//   * message_delta        → usage.output_tokens (final usage)
//   * message_stop         → terminal
//   * error                → terminal
//
// We DON'T handle tool_use blocks here — Phase 9 ships text streaming
// only; tool calling will land as an additive feature once a surface
// actually needs it (most likely the AI distribution flow when it ports).
public sealed class AnthropicProvider : IAiProvider {
    public string Provider => AiProviders.Anthropic;
    private const string DefaultEndpoint = "https://api.anthropic.com/v1/messages";
    private readonly HttpClient _http;
    public AnthropicProvider(HttpClient http) { _http = http; }

    public async IAsyncEnumerable<AiChunk> StreamAsync(
        AiProviderConfig config,
        string? systemPrompt,
        IReadOnlyList<AiMessage> messages,
        [EnumeratorCancellation] CancellationToken ct = default) {
        if (string.IsNullOrEmpty(config.ApiKey)) {
            yield return new AiChunk(AiChunkKind.Error, ErrorCode: "auth", ErrorMessage: "API key is required.");
            yield break;
        }

        var endpoint = string.IsNullOrWhiteSpace(config.BaseUrl) ? DefaultEndpoint : config.BaseUrl.TrimEnd('/') + "/v1/messages";
        var body = new {
            model = config.Model,
            max_tokens = config.MaxTokens ?? 1024,
            temperature = config.Temperature,
            system = systemPrompt,
            stream = true,
            messages = messages.Select(m => new {
                role = m.Role == AiRole.User ? "user" : "assistant",
                content = m.Content,
            }),
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint) {
            Content = JsonContent.Create(body),
        };
        req.Headers.Add("x-api-key", config.ApiKey);
        req.Headers.Add("anthropic-version", "2023-06-01");
        req.Headers.Add("Accept", "text/event-stream");

        HttpResponseMessage? resp = null;
        AiChunk? sendError = null;
        try {
            resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        } catch (HttpRequestException ex) {
            sendError = new AiChunk(AiChunkKind.Error, ErrorCode: "network", ErrorMessage: $"Couldn't reach upstream: {ex.Message}");
        } catch (TaskCanceledException) when (!ct.IsCancellationRequested) {
            sendError = new AiChunk(AiChunkKind.Error, ErrorCode: "network", ErrorMessage: "Upstream timeout.");
        }
        if (sendError is not null) {
            yield return sendError;
            yield break;
        }
        if (resp is null) yield break; // unreachable; keeps the compiler happy

        using var response = resp;

        if (!response.IsSuccessStatusCode) {
            var err = AiException.FromStatus(Provider, (int)response.StatusCode);
            yield return new AiChunk(AiChunkKind.Error, ErrorCode: err.Class.ToString().ToLowerInvariant(), ErrorMessage: err.Message);
            yield break;
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        AiTokenUsage? finalUsage = null;
        string? finishReason = null;

        await foreach (var (evt, data) in SseLineReader.ReadAsync(stream, ct)) {
            if (data == "[DONE]") break;
            JsonElement payload;
            JsonDocument? jsonDoc = null;
            try { jsonDoc = JsonDocument.Parse(data); payload = jsonDoc.RootElement.Clone(); }
            catch { continue; }
            finally { jsonDoc?.Dispose(); }

            switch (evt) {
                case "content_block_delta": {
                    var deltaText = payload.TryGetProperty("delta", out var d)
                        && d.TryGetProperty("text", out var t)
                            ? t.GetString() : null;
                    if (!string.IsNullOrEmpty(deltaText)) {
                        yield return new AiChunk(AiChunkKind.Delta, Text: deltaText);
                    }
                    break;
                }
                case "message_delta": {
                    if (payload.TryGetProperty("usage", out var u)) {
                        var output = u.TryGetProperty("output_tokens", out var ot) ? ot.GetInt32() : (int?)null;
                        finalUsage = new AiTokenUsage(null, output, null);
                    }
                    if (payload.TryGetProperty("delta", out var d2)
                        && d2.TryGetProperty("stop_reason", out var sr)) {
                        finishReason = sr.GetString();
                    }
                    break;
                }
                case "message_stop":
                    yield return new AiChunk(AiChunkKind.Done, FinishReason: finishReason, Usage: finalUsage);
                    yield break;
                case "error": {
                    var msg = payload.TryGetProperty("error", out var e)
                        && e.TryGetProperty("message", out var m)
                            ? m.GetString() : "Upstream error.";
                    yield return new AiChunk(AiChunkKind.Error, ErrorCode: "generic", ErrorMessage: msg);
                    yield break;
                }
            }
        }

        // Stream closed without an explicit message_stop — synthesise terminal.
        yield return new AiChunk(AiChunkKind.Done, FinishReason: finishReason ?? "stream_closed", Usage: finalUsage);
    }
}
