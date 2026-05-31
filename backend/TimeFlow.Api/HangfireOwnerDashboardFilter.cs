using Hangfire.Dashboard;

namespace TimeFlow.Api;

// Locks the Hangfire dashboard to authenticated Owners. The default
// Hangfire authorisation lets any local request through, which would
// expose job state + a job-trigger button to anyone on the docker
// network — not acceptable for a multi-tenant tool.
//
// In Phase 1 we don't have real users yet, so this effectively makes the
// dashboard inaccessible (it 401s) until Phase 3 ships login + the
// "owner" role claim. That's deliberate — better to start locked than
// to leave a hole open during the migration.
internal sealed class HangfireOwnerDashboardFilter : IDashboardAuthorizationFilter
{
    public bool Authorize(DashboardContext context)
    {
        var http = context.GetHttpContext();
        var user = http.User;
        return user.Identity?.IsAuthenticated == true && user.IsInRole("owner");
    }
}
