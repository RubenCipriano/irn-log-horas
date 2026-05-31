using System.Text.Json;
using TimeFlow.Integrations.Contract;

namespace TimeFlow.Integrations;

// Resolver from provider key → adapter, plus the JSON encode/decode for
// the credential payloads stored in `integration_connections`.
//
// Keeping credential JSON shape behind this registry means the API
// layer never instantiates a credential record by hand — fewer places
// to forget a field when adding a new provider.
public interface IIntegrationRegistry {
    IProjectIntegration Get(string provider);
    IntegrationCredentials DecodeCredentials(string provider, string json);
    string EncodeCredentials(IntegrationCredentials creds);
}

public sealed class IntegrationRegistry : IIntegrationRegistry {
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly Dictionary<string, IProjectIntegration> _byProvider;

    public IntegrationRegistry(IEnumerable<IProjectIntegration> adapters) {
        _byProvider = adapters.ToDictionary(a => a.Provider, StringComparer.Ordinal);
    }

    public IProjectIntegration Get(string provider) =>
        _byProvider.TryGetValue(provider, out var adapter)
            ? adapter
            : throw new ArgumentException($"Unknown integration provider '{provider}'.", nameof(provider));

    public IntegrationCredentials DecodeCredentials(string provider, string json) => provider switch {
        IntegrationProviders.OpenProject => Deserialize<OpenProjectCredentials>(json),
        IntegrationProviders.Jira => Deserialize<JiraCredentials>(json),
        IntegrationProviders.Linear => Deserialize<LinearCredentials>(json),
        IntegrationProviders.GitLab => Deserialize<GitLabCredentials>(json),
        _ => throw new ArgumentException($"Unknown integration provider '{provider}'.", nameof(provider)),
    };

    public string EncodeCredentials(IntegrationCredentials creds) =>
        JsonSerializer.Serialize(creds, creds.GetType(), JsonOpts);

    private static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json, JsonOpts)
            ?? throw new FormatException("Credential JSON is empty or invalid.");
}
