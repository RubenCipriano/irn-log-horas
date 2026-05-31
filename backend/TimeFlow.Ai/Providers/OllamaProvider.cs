using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TimeFlow.Ai.Contract;

namespace TimeFlow.Ai.Providers;

// Ollama (https://ollama.ai). Auth is none (it's local), so ApiKey is
// ignored. Streaming uses NDJSON (one JSON object per line), NOT SSE —
// each line is a full chunk like `{"message":{"content":"..."},"done":false}`.
//
// Default base URL = http://localhost:11434 — caller can override via
// AiProviderConfig.BaseUrl to point at a remote Ollama on their LAN.
public sealed class OllamaProvider : IAiProvider {
    public string Provider => AiProviders.Ollama;
    private const string DefaultBase = "http://localhost:11434";
    private readonly HttpClient _http;
    public OllamaProvider(HttpClient http) { _http = http; }

    public async IAsyncEnumerable<AiChunk> StreamAsync(
        AiProviderConfig config,
        string? systemPrompt,
        IReadOnlyList<AiMessage> messages,
        [EnumeratorCancellation] CancellationToken ct = default) {
        var baseUrl = string.IsNullOrWhiteSpace(config.BaseUrl) ? DefaultBase : config.BaseUrl.TrimEnd('/');
        var endpoint = $"{baseUrl}/api/chat";

        var ollamaMessages = new List<object>();
        if (!string.IsNullOrWhiteSpace(systemPrompt)) {
            ollamaMessages.Add(new { role = "system", content = systemPrompt });
        }
        foreach (var m in messages) {
            ollamaMessages.Add(new {
                role = m.Role == AiRole.User ? "user" : "assistant",
                content = m.Content,
            });
        }

        var body = new {
            model = config.Model,
            messages = ollamaMessages,
            stream = true,
            options = new {
                temperature = config.Temperature,
                num_predict = config.MaxTokens,
            },
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint) {
            Content = JsonContent.Create(body),
        };

        HttpResponseMessage? resp = null;
        AiChunk? sendError = null;
        try {
            resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        } catch (HttpRequestException ex) {
            sendError = new AiChunk(AiChunkKind.Error, ErrorCode: "network", ErrorMessage: $"Couldn't reach Ollama at {baseUrl}: {ex.Message}");
        } catch (TaskCanceledException) when (!ct.IsCancellationRequested) {
            sendError = new AiChunk(AiChunkKind.Error, ErrorCode: "network", ErrorMessage: "Ollama timeout.");
        }
        if (sendError is not null) {
            yield return sendError;
            yield break;
        }
        if (resp is null) yield break;

        using var response = resp;

        if (!response.IsSuccessStatusCode) {
            var err = AiException.FromStatus(Provider, (int)response.StatusCode);
            yield return new AiChunk(AiChunkKind.Error, ErrorCode: err.Class.ToString().ToLowerInvariant(), ErrorMessage: err.Message);
            yield break;
        }

        // StreamReader owns + disposes the underlying network stream; don't
        // also `await using` it here or the stream gets disposed twice.
        var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);
        string? finishReason = null;
        AiTokenUsage? finalUsage = null;

        while (!ct.IsCancellationRequested) {
            var line = await reader.ReadLineAsync(ct);
            if (line is null) break;
            if (string.IsNullOrWhiteSpace(line)) continue;

            JsonElement payload;
            JsonDocument? jsonDoc = null;
            try { jsonDoc = JsonDocument.Parse(line); payload = jsonDoc.RootElement.Clone(); }
            catch { continue; }
            finally { jsonDoc?.Dispose(); }

            if (payload.TryGetProperty("message", out var msg)
                && msg.TryGetProperty("content", out var c)
                && c.ValueKind == JsonValueKind.String) {
                var text = c.GetString();
                if (!string.IsNullOrEmpty(text)) {
                    yield return new AiChunk(AiChunkKind.Delta, Text: text);
                }
            }
            if (payload.TryGetProperty("done", out var done) && done.ValueKind == JsonValueKind.True) {
                if (payload.TryGetProperty("done_reason", out var dr) && dr.ValueKind == JsonValueKind.String) {
                    finishReason = dr.GetString();
                }
                // Ollama reports counts on the final message — translate.
                var promptTok = payload.TryGetProperty("prompt_eval_count", out var pe) ? pe.GetInt32() : (int?)null;
                var evalTok = payload.TryGetProperty("eval_count", out var ec) ? ec.GetInt32() : (int?)null;
                if (promptTok.HasValue || evalTok.HasValue) {
                    finalUsage = new AiTokenUsage(promptTok, evalTok,
                        promptTok.HasValue && evalTok.HasValue ? promptTok + evalTok : null);
                }
                break;
            }
        }

        yield return new AiChunk(AiChunkKind.Done, FinishReason: finishReason ?? "stop", Usage: finalUsage);
    }
}
