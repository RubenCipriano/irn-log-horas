using TimeFlow.Ai.Contract;

namespace TimeFlow.Ai;

// Resolves provider key (per-call config.Provider) → adapter instance.
//
// OpenAI / Groq / OpenRouter share a single adapter class
// (OpenAiCompatProvider) but each gets a registry entry with its own
// instance — that way each one has its own HttpClient with its own
// default base URL set at construction.
public interface IAiProviderRegistry {
    IAiProvider Get(string provider);
}

public sealed class AiProviderRegistry : IAiProviderRegistry {
    private readonly Dictionary<string, IAiProvider> _byKey;

    public AiProviderRegistry(IEnumerable<IAiProvider> providers) {
        _byKey = providers.ToDictionary(p => p.Provider, StringComparer.Ordinal);
    }

    public IAiProvider Get(string provider) =>
        _byKey.TryGetValue(provider, out var adapter)
            ? adapter
            : throw new ArgumentException($"Unknown AI provider '{provider}'.", nameof(provider));
}
