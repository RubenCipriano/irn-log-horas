using StackExchange.Redis;
using TimeFlow.Cache;

namespace TimeFlow.Auth;

// Redis-backed JWT revocation. Keys: `jwt:denylist:{jti}` with the value
// the revocation timestamp (informational only). TTL is set to the JWT's
// own expiry so the entry self-cleans — no background sweeper needed.
//
// Why per-jti and not per-user: per-user invalidation needs every active
// token to carry a "session version" claim that we'd have to compare on
// every request. Per-jti is one round trip to Redis (~0.2 ms) and tokens
// are short-lived (15 min default) so the worst-case denylist size is
// bounded by ACTIVE_TOKENS * AVERAGE_LIFE / 2 — trivial in Redis terms.
public sealed class RedisJwtRevocationStore : IJwtRevocationStore
{
    private const string KeyPrefix = "jwt:denylist:";
    // Per-user watermark key. Value = unix-seconds timestamp; any token
    // whose `iat` is at-or-before this is revoked. TTL matches the JWT
    // max-life so the key self-cleans without a sweeper.
    private const string UserWatermarkPrefix = "jwt:user-revoked:";
    private readonly IDatabase _db;

    public RedisJwtRevocationStore(RedisConnection redis)
    {
        _db = redis.Db;
    }

    public async Task<bool> IsRevokedAsync(string jti, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(jti)) return false;
        return await _db.KeyExistsAsync(KeyPrefix + jti);
    }

    public async Task RevokeAsync(string jti, DateTimeOffset expiresAt, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(jti)) return;
        var ttl = expiresAt - DateTimeOffset.UtcNow;
        if (ttl <= TimeSpan.Zero) return; // Token already expired — no-op.
        await _db.StringSetAsync(
            KeyPrefix + jti,
            DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            ttl);
    }

    public async Task RevokeAllForUserAsync(Guid userId, DateTimeOffset before, TimeSpan ttl, CancellationToken ct = default)
    {
        await _db.StringSetAsync(
            UserWatermarkPrefix + userId.ToString("N"),
            before.ToUnixTimeSeconds(),
            ttl);
    }

    public async Task<bool> IsUserRevokedAsync(Guid userId, DateTimeOffset issuedAt, CancellationToken ct = default)
    {
        var raw = await _db.StringGetAsync(UserWatermarkPrefix + userId.ToString("N"));
        if (raw.IsNullOrEmpty) return false;
        if (!long.TryParse(raw.ToString(), out var before)) return false;
        return issuedAt.ToUnixTimeSeconds() <= before;
    }
}
