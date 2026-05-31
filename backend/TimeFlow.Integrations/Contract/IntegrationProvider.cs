namespace TimeFlow.Integrations.Contract;

// Provider identifiers — used as the discriminator on
// `integration_connections.provider`, the key in IntegrationRegistry,
// and the slug in API responses. STRINGS so the wire format doesn't
// break if we reshuffle the enum.
public static class IntegrationProviders {
    public const string OpenProject = "openproject";
    public const string Jira = "jira";
    public const string Linear = "linear";
    public const string GitLab = "gitlab";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal) {
        OpenProject, Jira, Linear, GitLab,
    };

    public static bool IsKnown(string? key) => key is not null && All.Contains(key);
}
