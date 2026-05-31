namespace TimeFlow.Ai.Contract;

// One streamed update from a provider. Three flavours:
//   * Delta — partial text appended to the assistant's reply
//   * Done  — terminal marker carrying the finish reason + token usage
//   * Error — terminal marker carrying a bucketed error class
//
// `Kind` is the union discriminator. Surface SSE serialises each chunk
// as a separate `event: <kind>` block so the frontend can switch on the
// event type without parsing data first.
public enum AiChunkKind { Delta, Done, Error }

public sealed record AiChunk(
    AiChunkKind Kind,
    string? Text = null,
    string? FinishReason = null,
    AiTokenUsage? Usage = null,
    string? ErrorCode = null,
    string? ErrorMessage = null);

public sealed record AiTokenUsage(int? PromptTokens, int? CompletionTokens, int? TotalTokens);
