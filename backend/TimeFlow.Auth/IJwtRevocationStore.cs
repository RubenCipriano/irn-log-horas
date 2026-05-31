namespace TimeFlow.Auth;

// Revocation store for JWT `jti` (JWT ID) claims. When a user logs out,
// changes password, or has their session revoked by an admin, we add
// their token's jti to this store with a TTL equal to the remaining
// token life. Validating a token includes a denylist check — present in
// the set => 401.
//
// Per-user mass revocation: when a credential rotates we don't know every
// outstanding jti, so we publish a `iat` watermark for the user instead.
// Tokens with `iat < watermark` get rejected at validation time. Same
// per-request cost as the jti check, but invalidates every existing token
// at once.
//
// Interface is small so it's trivial to swap (in-memory for tests, Redis
// for prod).
public interface IJwtRevocationStore
{
    Task<bool> IsRevokedAsync(string jti, CancellationToken ct = default);
    Task RevokeAsync(string jti, DateTimeOffset expiresAt, CancellationToken ct = default);

    /// <summary>
    /// Set a watermark for the user — any token whose `iat` (issued-at) is
    /// before <paramref name="before"/> will be treated as revoked. TTL is
    /// usually one max-token-lifetime so the entry self-cleans.
    /// </summary>
    Task RevokeAllForUserAsync(Guid userId, DateTimeOffset before, TimeSpan ttl, CancellationToken ct = default);

    /// <summary>
    /// True when this user has a revocation watermark AND the supplied
    /// token <c>iat</c> falls at-or-before it.
    /// </summary>
    Task<bool> IsUserRevokedAsync(Guid userId, DateTimeOffset issuedAt, CancellationToken ct = default);
}
