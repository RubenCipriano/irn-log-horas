using StackExchange.Redis;

namespace TimeFlow.Cache;

// Singleton wrapper around StackExchange.Redis ConnectionMultiplexer.
// Reused across three concerns in the app:
//   - cache-aside read-through (Phase 4)
//   - JWT revocation denylist (this phase)
//   - Hangfire's job store (configured separately in Program.cs)
//
// The multiplexer is THREAD-SAFE and expensive to create — we hold ONE
// per process per Redis URL. DI registers it as a singleton.
public sealed class RedisConnection : IDisposable
{
    private readonly Lazy<ConnectionMultiplexer> _multiplexer;

    public RedisConnection(string connectionString)
    {
        _multiplexer = new Lazy<ConnectionMultiplexer>(
            () => ConnectionMultiplexer.Connect(connectionString));
    }

    public IDatabase Db => _multiplexer.Value.GetDatabase();
    public IConnectionMultiplexer Multiplexer => _multiplexer.Value;

    public void Dispose()
    {
        if (_multiplexer.IsValueCreated) _multiplexer.Value.Dispose();
    }
}
