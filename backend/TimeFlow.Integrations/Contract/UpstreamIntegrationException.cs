using System.Net;

namespace TimeFlow.Integrations.Contract;

// Single exception type adapters throw on any non-2xx upstream response
// or transport failure. The API layer maps `Class` to bucketed user-
// facing errors:
//   * Auth (401/403)         → "Credentials rejected by upstream."
//   * Server (5xx)           → "Upstream service is unavailable."
//   * Network                → "Couldn't reach upstream."
//   * Generic                → "Upstream returned an unexpected response."
//
// `UpstreamBody` is included for the SERVER logs only; the API never
// echoes it to clients (per the CLAUDE.md security baseline — upstream
// errors can leak credential fragments or internal paths).
public sealed class UpstreamIntegrationException : Exception {
    public UpstreamErrorClass Class { get; }
    public string Provider { get; }
    public HttpStatusCode? Status { get; }
    public string? UpstreamBody { get; }

    public UpstreamIntegrationException(string provider, UpstreamErrorClass cls, string message,
        HttpStatusCode? status = null, string? upstreamBody = null, Exception? inner = null)
        : base(message, inner) {
        Provider = provider;
        Class = cls;
        Status = status;
        UpstreamBody = upstreamBody;
    }

    public static UpstreamIntegrationException FromStatus(string provider, HttpStatusCode status, string? body) {
        var cls = (int)status switch {
            401 or 403 => UpstreamErrorClass.Auth,
            >= 500 and < 600 => UpstreamErrorClass.Server,
            _ => UpstreamErrorClass.Generic,
        };
        var msg = cls switch {
            UpstreamErrorClass.Auth => "Credentials rejected by upstream.",
            UpstreamErrorClass.Server => "Upstream service is unavailable.",
            _ => $"Upstream returned {(int)status} ({status}).",
        };
        return new UpstreamIntegrationException(provider, cls, msg, status, body);
    }
}

public enum UpstreamErrorClass { Auth, Server, Network, Generic }
