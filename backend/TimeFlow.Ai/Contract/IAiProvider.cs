namespace TimeFlow.Ai.Contract;

// Adapter contract — one implementation per upstream LLM API shape.
//
// `StreamAsync` MUST yield at least one terminal chunk (Done or Error)
// even if the upstream returns no deltas — that way the SSE consumer
// can always rely on a close signal instead of waiting on the
// connection to die.
public interface IAiProvider {
    /// <summary>Provider key (see AiProviders).</summary>
    string Provider { get; }

    /// <summary>Stream a single chat completion.</summary>
    IAsyncEnumerable<AiChunk> StreamAsync(
        AiProviderConfig config,
        string? systemPrompt,
        IReadOnlyList<AiMessage> messages,
        CancellationToken ct = default);
}
