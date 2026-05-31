namespace TimeFlow.Ai.Contract;

// Per-call provider config. The key arrives in the REQUEST BODY (not
// from a stored credential) — same contract the legacy app honoured.
// We never persist it, we never log it, and the AI surfaces accept the
// `Provider+Model+ApiKey+BaseUrl?` tuple on every call.
//
// `BaseUrl` is honoured for OpenAI-compat providers (Groq, OpenRouter,
// LM Studio, vLLM, Mistral via OpenAI shape, etc.) and for Ollama. The
// Anthropic provider ignores it (Anthropic doesn't have a self-hosted
// API surface).
public sealed record AiProviderConfig(
    string Provider,
    string Model,
    string? ApiKey,
    string? BaseUrl,
    decimal? Temperature = null,
    int? MaxTokens = null);
