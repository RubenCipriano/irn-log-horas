namespace TimeFlow.Api;

// Policy names for ASP.NET's RateLimiter middleware. Centralised so
// endpoint files don't sprinkle magic strings — and so renaming a policy
// only touches one spot.
public static class RateLimitPolicies {
    /// <summary>Auth + account routes. 30 requests / 60 s per IP.</summary>
    public const string Auth = "auth";

    /// <summary>AI streaming surfaces. Lower budget — every call costs upstream tokens.</summary>
    public const string Ai = "ai";

    /// <summary>
    /// Default bucket for every authenticated org-scoped route. 120 req/min
    /// per user — generous enough to support a chatty SPA polling sync-jobs
    /// + querying tasks without burning through, low enough to throttle a
    /// runaway script.
    /// </summary>
    public const string Authed = "authed";

    /// <summary>
    /// Expensive endpoints: CSV export, sync enqueue, anything that
    /// touches upstream APIs or builds a large payload. 10 req/min per user.
    /// </summary>
    public const string Expensive = "expensive";
}
