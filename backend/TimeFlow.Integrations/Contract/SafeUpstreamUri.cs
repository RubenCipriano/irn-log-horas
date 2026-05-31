using System.Net;
using System.Net.Sockets;

namespace TimeFlow.Integrations.Contract;

// SSRF guard for user-supplied integration BaseUrls.
//
// Every adapter builds its requests from a `BaseUrl` the user typed when
// they created the connection. Without validation an attacker can point a
// connection at cloud-metadata (169.254.169.254), loopback, or any
// RFC-1918 host and make the backend issue the request on their behalf —
// classic SSRF. This validator is the single choke point that rejects
// those targets before an HttpRequestMessage is ever sent.
//
// Failures surface as UpstreamIntegrationException(Network) so the caller
// buckets them exactly like an unreachable host — the user never learns
// whether the address was blocked because it was internal vs. simply down,
// and we never echo the offending URL back.
public static class SafeUpstreamUri {
    // http stays allowed: OpenProject / GitLab / Jira Server on-prem installs
    // are routinely served over plain http behind a corporate boundary. The
    // host checks below apply to http and https alike, so allowing http does
    // not widen the SSRF surface — it only relaxes transport encryption,
    // which is the operator's call for an internal tracker.
    private static readonly HashSet<string> AllowedSchemes =
        new(StringComparer.OrdinalIgnoreCase) { "http", "https" };

    /// <summary>
    /// Validate a user-supplied absolute URL string and return its parsed
    /// <see cref="Uri"/>. Throws <see cref="UpstreamIntegrationException"/>
    /// (Network class) on any rejection. <paramref name="provider"/> is the
    /// provider key used only for the typed exception — never the URL.
    /// </summary>
    public static Uri Validate(string url, string provider) {
        if (string.IsNullOrWhiteSpace(url) ||
            !Uri.TryCreate(url, UriKind.Absolute, out var uri)) {
            throw Blocked(provider);
        }
        return Validate(uri, provider);
    }

    public static Uri Validate(Uri uri, string provider) {
        if (!AllowedSchemes.Contains(uri.Scheme)) {
            throw Blocked(provider);
        }

        // Reject embedded credentials (`http://user:pass@host`). They have no
        // legitimate use for an API base URL and are a known way to smuggle a
        // different effective host past naive parsers.
        if (!string.IsNullOrEmpty(uri.UserInfo)) {
            throw Blocked(provider);
        }

        // `uri.Host` with brackets stripped for IPv6 literals.
        var host = uri.Host;
        if (string.IsNullOrEmpty(host)) {
            throw Blocked(provider);
        }

        // Literal IP in the URL: validate it directly. This catches the
        // metadata/loopback/private cases without any DNS lookup.
        if (IPAddress.TryParse(host, out var literal)) {
            if (IsBlockedAddress(literal)) {
                throw Blocked(provider);
            }
            return uri;
        }

        // Hostname: resolve and validate every A/AAAA record. A name that
        // maps to a private/metadata address (the common DNS-rebinding-lite
        // trick, e.g. an attacker A record pointing at 169.254.169.254) is
        // rejected. See the residual-risk note below.
        IPAddress[] resolved;
        try {
            resolved = Dns.GetHostAddresses(host);
        } catch (SocketException) {
            // Unresolvable — treat as unreachable, same bucket.
            throw Blocked(provider);
        }
        if (resolved.Length == 0 || resolved.Any(IsBlockedAddress)) {
            throw Blocked(provider);
        }

        return uri;
        // RESIDUAL RISK (DNS rebinding): we validate at request-build time,
        // but HttpClient re-resolves the name when it actually connects. A
        // hostile resolver can return a public IP here and a private IP a
        // moment later. Fully closing this needs resolve-then-pin-the-socket
        // plumbing (custom SocketsHttpHandler ConnectCallback) which is out
        // of scope for the adapter layer. The literal-IP path above is not
        // affected and blocks the direct metadata/loopback attacks outright.
    }

    private static bool IsBlockedAddress(IPAddress ip) {
        // Normalise IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254) so the
        // v4 rules below still catch a v4 target wearing a v6 hat.
        if (ip.IsIPv4MappedToIPv6) {
            ip = ip.MapToIPv4();
        }

        if (IPAddress.IsLoopback(ip)) return true;                 // 127/8, ::1
        if (ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any)) return true; // 0.0.0.0, ::

        if (ip.AddressFamily == AddressFamily.InterNetwork) {
            var b = ip.GetAddressBytes();
            // 10.0.0.0/8
            if (b[0] == 10) return true;
            // 172.16.0.0/12
            if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return true;
            // 192.168.0.0/16
            if (b[0] == 192 && b[1] == 168) return true;
            // 169.254.0.0/16 — link-local; covers cloud metadata 169.254.169.254
            if (b[0] == 169 && b[1] == 254) return true;
            // 100.64.0.0/10 — carrier-grade NAT, also non-public
            if (b[0] == 100 && b[1] >= 64 && b[1] <= 127) return true;
            // 0.0.0.0/8 — "this network"
            if (b[0] == 0) return true;
            return false;
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6) {
            if (ip.IsIPv6LinkLocal) return true;        // fe80::/10
            if (ip.IsIPv6SiteLocal) return true;        // fec0::/10 (deprecated)
            if (ip.IsIPv6UniqueLocal) return true;      // fc00::/7
            var b = ip.GetAddressBytes();
            // fc00::/7 fallback (older runtimes lacked IsIPv6UniqueLocal).
            if ((b[0] & 0xFE) == 0xFC) return true;
            return false;
        }

        // Unknown family — refuse rather than guess.
        return true;
    }

    private static UpstreamIntegrationException Blocked(string provider) =>
        // Deliberately the same message + class as a genuinely unreachable
        // host: don't disclose that the target was blocked for being internal.
        new(provider, UpstreamErrorClass.Network, "Couldn't reach upstream.");
}
