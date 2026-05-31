namespace TimeFlow.Integrations.Contract;

// Provider-specific credential records. All are serialised to JSON
// before being handed to TimeFlow.Vault.Encrypt — the encrypted blob
// is what lands on `integration_connections.encrypted_credentials`.
//
// `BaseUrl` is on every provider that supports self-hosting
// (OpenProject, Jira Server, GitLab); Linear is SaaS-only so it omits.
//
// Validation: the adapter's VerifyAsync is the source of truth for whether
// the credential works. The BaseUrl host is additionally SSRF-screened at
// request-build time (see SafeUpstreamUri) so a connection can never be
// pointed at loopback / link-local / private / cloud-metadata targets.
public abstract record IntegrationCredentials {
    public abstract string Provider { get; }
}

public sealed record OpenProjectCredentials(string BaseUrl, string Token) : IntegrationCredentials {
    public override string Provider => IntegrationProviders.OpenProject;
}

public sealed record JiraCredentials(string BaseUrl, string Email, string Token) : IntegrationCredentials {
    public override string Provider => IntegrationProviders.Jira;
}

public sealed record LinearCredentials(string Token) : IntegrationCredentials {
    public override string Provider => IntegrationProviders.Linear;
}

public sealed record GitLabCredentials(string BaseUrl, string Token) : IntegrationCredentials {
    public override string Provider => IntegrationProviders.GitLab;
}
