using System.Text.Json;
using StackExchange.Redis;

namespace TimeFlow.Cache;

// Redis implementation of ICacheStore.
//
// Key layout (all under the CACHE_NS prefix passed at construction):
//   {ns}:k:{key}        — JSON-serialised cache entry
//   {ns}:t:{tag}        — SET of keys tagged with this tag
//
// Tag indexing happens on every GetOrSetAsync miss: after writing the
// value we SADD the key into each tag's set, and EXPIRE the tag set to
// the largest TTL we've ever attached to it (so abandoned tags
// eventually self-clean). This is cheaper than maintaining a reverse
// index (per-key list of tags) and good enough because tags are
// invalidated as a unit.
//
// Invalidation pipelines the SMEMBERS + DEL into one batch so a thousand-
// entry tag drops in a single network round trip.
public sealed class RedisCacheStore : ICacheStore {
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly IDatabase _db;
    private readonly string _ns;

    public RedisCacheStore(RedisConnection redis, string @namespace = "tf") {
        _db = redis.Db;
        _ns = string.IsNullOrWhiteSpace(@namespace) ? "tf" : @namespace.TrimEnd(':');
    }

    public async Task<T> GetOrSetAsync<T>(
        string key,
        TimeSpan ttl,
        IReadOnlyCollection<string> tags,
        Func<CancellationToken, Task<T>> loader,
        CancellationToken ct = default) {
        var redisKey = KeyFor(key);

        var cached = await _db.StringGetAsync(redisKey);
        if (!cached.IsNullOrEmpty) {
            var hit = JsonSerializer.Deserialize<T>(cached!, JsonOpts);
            // Deserialize can return default(T) for a stored null; treat
            // null hit as miss for reference types so the loader still runs.
            if (hit is not null) return hit;
        }

        var fresh = await loader(ct);
        var payload = JsonSerializer.SerializeToUtf8Bytes(fresh, JsonOpts);

        // Pipeline: set the value + index it under every tag in one batch.
        var batch = _db.CreateBatch();
        var tasks = new List<Task> { batch.StringSetAsync(redisKey, payload, ttl) };
        foreach (var tag in tags) {
            var tagKey = TagKeyFor(tag);
            tasks.Add(batch.SetAddAsync(tagKey, redisKey));
            // Tags live a bit longer than their entries so InvalidateTagsAsync
            // can find every key even if some have TTL'd ahead of others.
            tasks.Add(batch.KeyExpireAsync(tagKey, ttl + TimeSpan.FromMinutes(5), ExpireWhen.GreaterThanCurrentExpiry));
        }
        batch.Execute();
        await Task.WhenAll(tasks);
        return fresh;
    }

    public async Task InvalidateKeyAsync(string key, CancellationToken ct = default) {
        await _db.KeyDeleteAsync(KeyFor(key));
        // We don't bother cleaning the SADD back-reference here — tag-set
        // members that point to dead keys are harmless (SMEMBERS returns
        // them, DEL on a non-existent key is a no-op).
    }

    public async Task InvalidateTagsAsync(IReadOnlyCollection<string> tags, CancellationToken ct = default) {
        if (tags.Count == 0) return;

        var batch = _db.CreateBatch();
        var memberTasks = tags
            .Select(t => (Tag: t, Members: batch.SetMembersAsync(TagKeyFor(t))))
            .ToList();
        batch.Execute();

        var allKeys = new HashSet<RedisKey>();
        foreach (var (tag, membersTask) in memberTasks) {
            var members = await membersTask;
            foreach (var m in members) allKeys.Add((string)m!);
            allKeys.Add(TagKeyFor(tag));
        }

        if (allKeys.Count == 0) return;
        await _db.KeyDeleteAsync(allKeys.ToArray());
    }

    public async Task InvalidatePatternAsync(string pattern, CancellationToken ct = default) {
        // SCAN over the namespace, batched delete. Sparingly used — most
        // invalidations should go through tags. Pattern is relative to
        // the cache namespace, not the global key space.
        var server = GetSingleServer();
        var fullPattern = KeyFor(pattern);
        var keys = new List<RedisKey>();
        await foreach (var key in server.KeysAsync(_db.Database, fullPattern).WithCancellation(ct)) {
            keys.Add(key);
            if (keys.Count >= 500) {
                await _db.KeyDeleteAsync(keys.ToArray());
                keys.Clear();
            }
        }
        if (keys.Count > 0) {
            await _db.KeyDeleteAsync(keys.ToArray());
        }
    }

    private IServer GetSingleServer() {
        // For SCAN we need a connected server endpoint. Single-node Redis
        // exposes exactly one; if we ever cluster, this needs revisiting.
        var mux = _db.Multiplexer;
        var ep = mux.GetEndPoints().FirstOrDefault()
            ?? throw new InvalidOperationException("Redis multiplexer has no endpoints.");
        return mux.GetServer(ep);
    }

    private string KeyFor(string key) => $"{_ns}:k:{key}";
    private string TagKeyFor(string tag) => $"{_ns}:t:{tag}";
}
