using System.Security.Cryptography;
using StackExchange.Redis;
using TimeFlow.Cache;

namespace TimeFlow.Auth;

// Holds the short-lived (5 min) token issued between password-success
// and TOTP-verify during a 2FA-enabled login. Redis-backed so it
// auto-expires and survives process restarts.
//
// Key: `2fa:challenge:{token}`  Value: userId (UUID string)
//
// Tokens are 32 bytes of CSPRNG entropy, base64url-encoded — opaque to
// the client. ConsumeAsync is single-use (GETDEL) so a token can't be
// replayed even within the TTL.
public interface ITwoFactorChallengeStore {
    Task<string> CreateAsync(Guid userId, CancellationToken ct = default);
    Task<Guid?> ConsumeAsync(string token, CancellationToken ct = default);
}

public sealed class RedisTwoFactorChallengeStore : ITwoFactorChallengeStore {
    private const string KeyPrefix = "2fa:challenge:";
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);

    private readonly IDatabase _db;

    public RedisTwoFactorChallengeStore(RedisConnection redis) {
        _db = redis.Db;
    }

    public async Task<string> CreateAsync(Guid userId, CancellationToken ct = default) {
        var bytes = RandomNumberGenerator.GetBytes(32);
        var token = Base64UrlNoPad(bytes);
        await _db.StringSetAsync(KeyPrefix + token, userId.ToString("D"), Ttl);
        return token;
    }

    public async Task<Guid?> ConsumeAsync(string token, CancellationToken ct = default) {
        if (string.IsNullOrWhiteSpace(token)) return null;
        // GETDEL returns the value and removes the key in one round trip,
        // making consumption single-use even under race conditions.
        var value = await _db.StringGetDeleteAsync(KeyPrefix + token);
        if (value.IsNullOrEmpty) return null;
        return Guid.TryParse(value.ToString(), out var id) ? id : null;
    }

    private static string Base64UrlNoPad(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
