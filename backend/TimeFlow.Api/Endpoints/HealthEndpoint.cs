using System.Reflection;

namespace TimeFlow.Api.Endpoints;

// Anonymous health check. Used by:
//   - Docker HEALTHCHECK directive in backend/Dockerfile
//   - nginx upstream probing (so a dead backend is dropped from rotation)
//   - the SPA's stub page during Phase 1 to prove the round-trip works
//
// Cheap on purpose — no DB hit, no Redis ping. If we ever need a deeper
// readiness probe, expose /api/ready separately and keep /api/health
// liveness-only so a slow DB doesn't restart the container.
public static class HealthEndpoint
{
    private static readonly string Version =
        Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0";

    public static IResult Handle() => Results.Ok(new
    {
        ok = true,
        timestamp = DateTimeOffset.UtcNow,
        version = Version,
    });
}
