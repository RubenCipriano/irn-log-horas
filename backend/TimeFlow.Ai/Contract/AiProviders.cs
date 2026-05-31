namespace TimeFlow.Ai.Contract;

// Provider keys (wire-format strings used in AiProviderConfig.Provider
// and the AiProviderRegistry). Single source of truth so the API surface
// + the registry never drift.
public static class AiProviders {
    public const string Anthropic = "anthropic";
    public const string OpenAI = "openai";
    public const string Groq = "groq";
    public const string OpenRouter = "openrouter";
    public const string Ollama = "ollama";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) {
        Anthropic, OpenAI, Groq, OpenRouter, Ollama,
    };

    public static bool IsKnown(string? key) => key is not null && All.Contains(key);
}

// Bucketed failure classes for AiException. Matches the integration-side
// shape (auth / server / network / generic) so the SPA error mapper can
// stay uniform across both subsystems.
public enum AiErrorClass { Auth, Server, Network, Generic }

public sealed class AiException : Exception {
    public AiErrorClass Class { get; }
    public string Provider { get; }
    public int? Status { get; }

    public AiException(string provider, AiErrorClass cls, string message, int? status = null, Exception? inner = null)
        : base(message, inner) {
        Provider = provider;
        Class = cls;
        Status = status;
    }

    public static AiException FromStatus(string provider, int status) {
        var cls = status switch {
            401 or 403 => AiErrorClass.Auth,
            >= 500 and < 600 => AiErrorClass.Server,
            _ => AiErrorClass.Generic,
        };
        var msg = cls switch {
            AiErrorClass.Auth => "AI provider rejected the API key.",
            AiErrorClass.Server => "AI provider is unavailable.",
            _ => $"AI provider returned {status}.",
        };
        return new AiException(provider, cls, msg, status);
    }
}
