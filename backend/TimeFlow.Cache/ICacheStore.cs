namespace TimeFlow.Cache;

// Read-through cache contract — every server-side DB read in the app
// goes through `GetOrSetAsync(key, ttl, tags, loader)`. The implementation
// indexes each key under its tags so a single `InvalidateTagsAsync(tag)`
// can drop every cached entry that involved that tag.
//
// Tag conventions match the CLAUDE.md table — `user:{id}`,
// `org:{id}:members`, `org:{id}:projects`, etc. Endpoint code is the
// one place that knows which tags a query belongs to; the cache layer
// stays domain-agnostic.
public interface ICacheStore {
    /// <summary>
    /// Return the cached value or call <paramref name="loader"/> and cache its
    /// result. Tags index the key for later mass invalidation.
    /// </summary>
    Task<T> GetOrSetAsync<T>(
        string key,
        TimeSpan ttl,
        IReadOnlyCollection<string> tags,
        Func<CancellationToken, Task<T>> loader,
        CancellationToken ct = default);

    /// <summary>Drop a single key (and its tag-index back-references).</summary>
    Task InvalidateKeyAsync(string key, CancellationToken ct = default);

    /// <summary>Drop every key indexed under any of the given tags.</summary>
    Task InvalidateTagsAsync(IReadOnlyCollection<string> tags, CancellationToken ct = default);

    /// <summary>Drop every key matching the redis-style pattern (use sparingly — O(N) on the keyspace).</summary>
    Task InvalidatePatternAsync(string pattern, CancellationToken ct = default);
}
