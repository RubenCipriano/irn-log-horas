using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TimeFlow.Ai.Contract;

namespace TimeFlow.Ai.Providers;

// Covers every OpenAI-shaped provider: OpenAI itself, Groq, OpenRouter,
// LM Studio, vLLM, Together, Mistral. They all expose
// `/v1/chat/completions` with `stream: true` and Bearer auth.
//
// Differences live entirely in the BaseUrl + the Provider string we
// report. We pick the default endpoint based on the provider key so
// callers don't have to supply BaseUrl for the three SaaS ones.
public sealed class OpenAiCompatProvider : IAiProvider {
    public string Provider { get; }
    private readonly string _defaultBase;
    private readonly HttpClient _http;

    public OpenAiCompatProvider(string provider, string defaultBase, HttpClient http) {
        Provider = provider;
        _defaultBase = defaultBase;
        _http = http;
    }

    public async IAsyncEnumerable<AiChunk> StreamAsync(
        AiProviderConfig config,
        string? systemPrompt,
        IReadOnlyList<AiMessage> messages,
        [EnumeratorCancellation] CancellationToken ct = default) {
        if (string.IsNullOrEmpty(config.ApiKey)) {
            yield return new AiChunk(AiChunkKind.Error, ErrorCode: "auth", ErrorMessage: "API key is required.");
            yield break;
        }

        var baseUrl = string.IsNullOrWhiteSpace(config.BaseUrl) ? _defaultBase : config.BaseUrl.TrimEnd('/');
        // The convention everywhere: `{baseUrl}/chat/completions`. If the
        // caller supplied the full host without `/v1`, OpenRouter / LM
        // Studio / etc. still work because they all mount the same path.
        var endpoint = baseUrl.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase)
            ? baseUrl
            : baseUrl + "/chat/completions";

        var allMessages = new List<object>();
        if (!string.IsNullOrWhiteSpace(systemPrompt)) {
            allMessages.Add(new { role = "system", content = systemPrompt });
        }
        foreach (var m in messages) {
            allMessages.Add(new {
                role = m.Role == AiRole.User ? "user" : "assistant",
                content = m.Content,
            });
        }

        var body = new {
            model = config.Model,
            messages = allMessages,
            stream = true,
            temperature = config.Temperature,
            max_tokens = config.MaxTokens,
            stream_options = new { include_usage = true },
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, endpoint) {
            Content = JsonContent.Create(body),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiKey);
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
        if (resp is null) yield break;

        using var response = resp;

        if (!response.IsSuccessStatusCode) {
            var err = AiException.FromStatus(Provider, (int)response.StatusCode);
            yield return new AiChunk(AiChunkKind.Error, ErrorCode: err.Class.ToString().ToLowerInvariant(), ErrorMessage: err.Message);
            yield break;
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        AiTokenUsage? finalUsage = null;
        string? finishReason = null;

        await foreach (var (_, data) in SseLineReader.ReadAsync(stream, ct)) {
            if (data == "[DONE]") break;
            JsonElement payload;
            JsonDocument? jsonDoc = null;
            try { jsonDoc = JsonDocument.Parse(data); payload = jsonDoc.RootElement.Clone(); }
            catch { continue; }
            finally { jsonDoc?.Dispose(); }

            // Some implementations send usage in a final chunk with empty
            // choices; others embed it on the last `choices[0].finish_reason`
            // delta. Handle both.
            if (payload.TryGetProperty("usage", out var usage) && usage.ValueKind == JsonValueKind.Object) {
                finalUsage = new AiTokenUsage(
                    PromptTokens: usage.TryGetProperty("prompt_tokens", out var pt) ? pt.GetInt32() : null,
                    CompletionTokens: usage.TryGetProperty("completion_tokens", out var ct2) ? ct2.GetInt32() : null,
                    TotalTokens: usage.TryGetProperty("total_tokens", out var tt) ? tt.GetInt32() : null);
            }

            if (payload.TryGetProperty("choices", out var choices) && choices.ValueKind == JsonValueKind.Array && choices.GetArrayLength() > 0) {
                var choice = choices[0];
                if (choice.TryGetProperty("delta", out var delta)
                    && delta.TryGetProperty("content", out var c)
                    && c.ValueKind == JsonValueKind.String) {
                    var text = c.GetString();
                    if (!string.IsNullOrEmpty(text)) {
                        yield return new AiChunk(AiChunkKind.Delta, Text: text);
                    }
                }
                if (choice.TryGetProperty("finish_reason", out var fr) && fr.ValueKind == JsonValueKind.String) {
                    finishReason = fr.GetString();
                }
            }
        }

        yield return new AiChunk(AiChunkKind.Done, FinishReason: finishReason ?? "stream_closed", Usage: finalUsage);
    }
}
