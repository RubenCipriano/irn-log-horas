using System.Text;
using System.Threading.RateLimiting;
using Hangfire;
using Hangfire.PostgreSql;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api;
using TimeFlow.Api.Endpoints;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Ai;
using TimeFlow.Ai.Contract;
using TimeFlow.Ai.Providers;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Integrations;
using TimeFlow.Integrations.Adapters;
using TimeFlow.Integrations.Contract;
using TimeFlow.Rbac;
using TimeFlow.Vault;

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
var databaseUrl = builder.Configuration["DATABASE_URL"]
    ?? throw new InvalidOperationException("DATABASE_URL is required");
var redisUrl = builder.Configuration["REDIS_URL"]
    ?? throw new InvalidOperationException("REDIS_URL is required");
var jwtSecret = builder.Configuration["JWT_SECRET"]
    ?? throw new InvalidOperationException("JWT_SECRET is required (>= 32 bytes after base64-decode)");
var vaultKey = builder.Configuration["VAULT_KEY"]
    ?? throw new InvalidOperationException("VAULT_KEY is required (>= 32 bytes after base64-decode)");
var cacheNamespace = builder.Configuration["CACHE_NS"] ?? "tf";
var requireHttps = builder.Environment.IsProduction();

// A weak or placeholder key lets an attacker forge a token (JWT) or
// brute-force the envelope (vault) → cross-tenant auth bypass / data
// disclosure. Both consumers silently accept a sub-32-byte key at use-time,
// so boot is the only place to fail fast on it.
RejectWeakSecret("JWT_SECRET", jwtSecret, vaultStyle: false);
RejectWeakSecret("VAULT_KEY", vaultKey, vaultStyle: true);

static void RejectWeakSecret(string name, string value, bool vaultStyle)
{
    string[] sentinels =
    {
        "replace-with-openssl-rand-base64-32",
        "replace-me-with-a-strong-password",
        "changeme", "change-me", "secret", "dev-secret",
    };
    if (sentinels.Contains(value.Trim(), StringComparer.OrdinalIgnoreCase))
        throw new InvalidOperationException(
            $"{name} holds a known dev sentinel. Generate a real one: openssl rand -base64 32");

    // The effective key bytes must match what the consumer derives, or boot
    // could pass a value that the consumer later rejects (or vice versa):
    //   JWT  (JwtCookieAuthHandler.GetKeyBytes): base64 only when it yields
    //        >= 32 bytes, otherwise the raw UTF-8 string.
    //   Vault (Aes256GcmVault.DecodeMasterKey): base64 whenever the string is
    //        valid base64 (no length-based fallback), otherwise raw UTF-8.
    byte[] keyBytes;
    try
    {
        var decoded = Convert.FromBase64String(value);
        keyBytes = (vaultStyle || decoded.Length >= 32) ? decoded : Encoding.UTF8.GetBytes(value);
    }
    catch (FormatException)
    {
        keyBytes = Encoding.UTF8.GetBytes(value);
    }
    if (keyBytes.Length < 32)
        throw new InvalidOperationException(
            $"{name} must be >= 32 bytes after base64-decode. Generate: openssl rand -base64 32");
}

// ---------------------------------------------------------------------------
// EF Core — application schema (users, 2fa, and everything that lands in
// later phases). Hangfire owns its own schema and migrates separately.
// ---------------------------------------------------------------------------
builder.Services.AddDbContext<TimeFlowDbContext>(opt =>
    opt.UseNpgsql(databaseUrl, npg => npg.MigrationsAssembly(typeof(TimeFlowDbContext).Assembly.GetName().Name)));

// ---------------------------------------------------------------------------
// Redis (shared singleton) — JWT denylist, 2FA challenge store, cache-aside
// (Phase 4), Hangfire's LockManager indirectly.
// ---------------------------------------------------------------------------
builder.Services.AddSingleton(new RedisConnection(redisUrl));
builder.Services.AddSingleton<IJwtRevocationStore, RedisJwtRevocationStore>();
builder.Services.AddSingleton<ITwoFactorChallengeStore, RedisTwoFactorChallengeStore>();

// ---------------------------------------------------------------------------
// Auth crypto services
// ---------------------------------------------------------------------------
builder.Services.AddSingleton<IPasswordHasher, Argon2PasswordHasher>();
builder.Services.AddSingleton<ITotpService, TotpService>();

// ---------------------------------------------------------------------------
// Vault — AES-256-GCM envelope encryption with HKDF-derived per-context
// data keys. Used to seal integration credentials, AI provider keys, 2FA
// recovery codes, etc. The master key is the long-lived secret; data keys
// are derived per-blob and never persisted.
// ---------------------------------------------------------------------------
builder.Services.AddSingleton<IVaultService>(_ => new Aes256GcmVault(vaultKey));

// ---------------------------------------------------------------------------
// Cache — read-through with tag indexing. Endpoint code passes the tags
// each cached query touches; mutations call InvalidateTagsAsync on those
// same tags to keep things coherent.
// ---------------------------------------------------------------------------
builder.Services.AddSingleton<ICacheStore>(sp => new RedisCacheStore(
    sp.GetRequiredService<RedisConnection>(),
    cacheNamespace));

// ---------------------------------------------------------------------------
// RBAC — IOrgMembershipReader resolves (userId, orgId) → role for the
// RequireOrgPermission filter. Cached for 5 min, invalidated on member
// changes via the `org:{orgId}:members` tag.
// ---------------------------------------------------------------------------
builder.Services.AddScoped<IOrgMembershipReader, CachedOrgMembershipReader>();

// ---------------------------------------------------------------------------
// Audit logger — central writer for security/compliance events.
// ---------------------------------------------------------------------------
builder.Services.AddScoped<IAuditLogger, AuditLogger>();
builder.Services.AddScoped<ProjectPolicyResolver>();
builder.Services.AddSingleton<TimeFlow.Billing.IInvoicePdfRenderer, TimeFlow.Billing.InvoicePdfRenderer>();
// QuestPDF Community license — required by the library at process start.
QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

// ---------------------------------------------------------------------------
// Integration adapters — each wraps an upstream tracker behind the
// common IProjectIntegration contract. HttpClient is injected via the
// typed-client pattern so the framework manages connection pooling +
// the message handler lifetime.
//
// All four adapters get a 30-second timeout — long enough for a paged
// Jira search but short enough that a hung upstream doesn't pin a
// request thread.
// ---------------------------------------------------------------------------
builder.Services.AddHttpClient<OpenProjectAdapter>(c => c.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddHttpClient<JiraAdapter>(c => c.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddHttpClient<LinearAdapter>(c => c.Timeout = TimeSpan.FromSeconds(30));
builder.Services.AddHttpClient<GitLabAdapter>(c => c.Timeout = TimeSpan.FromSeconds(30));

// Expose each adapter under both its concrete type (so HttpClient DI
// works) AND the IProjectIntegration contract (so IntegrationRegistry
// can enumerate them).
builder.Services.AddScoped<IProjectIntegration>(sp => sp.GetRequiredService<OpenProjectAdapter>());
builder.Services.AddScoped<IProjectIntegration>(sp => sp.GetRequiredService<JiraAdapter>());
builder.Services.AddScoped<IProjectIntegration>(sp => sp.GetRequiredService<LinearAdapter>());
builder.Services.AddScoped<IProjectIntegration>(sp => sp.GetRequiredService<GitLabAdapter>());
builder.Services.AddScoped<IIntegrationRegistry, IntegrationRegistry>();

// Hangfire-invokable worker (Phase 8). Scoped so each execution gets
// a fresh DbContext + HttpClient.
builder.Services.AddScoped<WorklogSyncJob>();
builder.Services.AddScoped<WorklogPushJob>();

// ---------------------------------------------------------------------------
// AI providers (Phase 9). Each adapter gets its own HttpClient via the
// typed-client pattern so connection pooling stays per-host. SSE
// responses can be long, so we give them a longer timeout than the
// integration adapters (5 min — generous, but caller can cancel via
// the request CT to bail earlier).
//
// The three OpenAI-shaped providers (openai / groq / openrouter) all
// share OpenAiCompatProvider but each gets its own DI registration so
// the registry can hand back the right default base URL per provider.
// ---------------------------------------------------------------------------
builder.Services.AddHttpClient<AnthropicProvider>(c => c.Timeout = TimeSpan.FromMinutes(5));
builder.Services.AddHttpClient<OllamaProvider>(c => c.Timeout = TimeSpan.FromMinutes(5));
builder.Services.AddHttpClient("ai.openai", c => c.Timeout = TimeSpan.FromMinutes(5));
builder.Services.AddHttpClient("ai.groq", c => c.Timeout = TimeSpan.FromMinutes(5));
builder.Services.AddHttpClient("ai.openrouter", c => c.Timeout = TimeSpan.FromMinutes(5));

builder.Services.AddSingleton<IAiProvider>(sp => sp.GetRequiredService<AnthropicProvider>());
builder.Services.AddSingleton<IAiProvider>(sp => sp.GetRequiredService<OllamaProvider>());
builder.Services.AddSingleton<IAiProvider>(sp => new OpenAiCompatProvider(
    AiProviders.OpenAI,
    "https://api.openai.com/v1",
    sp.GetRequiredService<IHttpClientFactory>().CreateClient("ai.openai")));
builder.Services.AddSingleton<IAiProvider>(sp => new OpenAiCompatProvider(
    AiProviders.Groq,
    "https://api.groq.com/openai/v1",
    sp.GetRequiredService<IHttpClientFactory>().CreateClient("ai.groq")));
builder.Services.AddSingleton<IAiProvider>(sp => new OpenAiCompatProvider(
    AiProviders.OpenRouter,
    "https://openrouter.ai/api/v1",
    sp.GetRequiredService<IHttpClientFactory>().CreateClient("ai.openrouter")));
builder.Services.AddSingleton<IAiProviderRegistry, AiProviderRegistry>();

// ---------------------------------------------------------------------------
// Auth: custom JWT-in-cookie scheme (see TimeFlow.Auth.JwtCookieAuthHandler)
// ---------------------------------------------------------------------------
builder.Services
    .AddAuthentication(JwtCookieAuthHandler.SchemeName)
    .AddScheme<JwtCookieAuthOptions, JwtCookieAuthHandler>(
        JwtCookieAuthHandler.SchemeName,
        options =>
        {
            options.Secret = jwtSecret;
            options.RequireHttps = requireHttps;
            options.Issuer = "timeflow";
            options.Audience = "timeflow-spa";
        });
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("RequireOwner", p => p.RequireRole("owner"));
});

// ---------------------------------------------------------------------------
// Rate limiting — fixed window, partitioned by client IP. 30 requests per
// 60 s mirrors the Better Auth defaults the legacy stack used. Applies to
// /api/auth/* and /api/account/* via [RequireRateLimiting(...)] on the
// endpoint groups. Anonymous endpoints (e.g. /api/health) skip it.
// ---------------------------------------------------------------------------
builder.Services.AddRateLimiter(opts =>
{
    opts.AddPolicy(RateLimitPolicies.Auth, http =>
    {
        var key = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 30,
            Window = TimeSpan.FromSeconds(60),
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            AutoReplenishment = true,
        });
    });
    // AI: per-user (sub claim) rather than per-IP — same office sharing
    // an IP shouldn't share the AI budget. Lower ceiling because each
    // call burns upstream tokens.
    opts.AddPolicy(RateLimitPolicies.Ai, http =>
    {
        var key = http.User.FindFirst("sub")?.Value
            ?? http.Connection.RemoteIpAddress?.ToString()
            ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 20,
            Window = TimeSpan.FromSeconds(60),
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            AutoReplenishment = true,
        });
    });
    // Default-authed bucket: 120 req/min per user. The SPA polls sync-jobs
    // + queries org pages routinely; this is generous enough not to gate
    // normal use but stops a runaway loop fast.
    opts.AddPolicy(RateLimitPolicies.Authed, http =>
    {
        var key = http.User.FindFirst("sub")?.Value
            ?? http.Connection.RemoteIpAddress?.ToString()
            ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 120,
            Window = TimeSpan.FromSeconds(60),
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            AutoReplenishment = true,
        });
    });
    // Expensive bucket: anything that builds a big payload or talks to an
    // upstream API (CSV export, sync enqueue, ai surfaces if not already
    // tagged). 10 req/min/user.
    opts.AddPolicy(RateLimitPolicies.Expensive, http =>
    {
        var key = http.User.FindFirst("sub")?.Value
            ?? http.Connection.RemoteIpAddress?.ToString()
            ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromSeconds(60),
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            AutoReplenishment = true,
        });
    });
    opts.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // GLOBAL limiter — applied to every request. Authenticated users get
    // the Authed bucket keyed on `sub`; anonymous traffic falls through
    // to a generous-but-bounded per-IP bucket (1000 req/min). Per-endpoint
    // RequireRateLimiting still works for tighter buckets on top.
    opts.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
    {
        var sub = http.User.FindFirst("sub")?.Value;
        if (!string.IsNullOrEmpty(sub))
        {
            return RateLimitPartition.GetFixedWindowLimiter($"u:{sub}", _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 120,
                Window = TimeSpan.FromSeconds(60),
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                AutoReplenishment = true,
            });
        }
        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter($"ip:{ip}", _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 1000,
            Window = TimeSpan.FromSeconds(60),
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            AutoReplenishment = true,
        });
    });
});

// ---------------------------------------------------------------------------
// Hangfire — Postgres-backed background job queue.
// ---------------------------------------------------------------------------
builder.Services.AddHangfire(cfg => cfg
    .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
    .UseSimpleAssemblyNameTypeSerializer()
    .UseRecommendedSerializerSettings()
    .UsePostgreSqlStorage(opt => opt.UseNpgsqlConnection(databaseUrl)));
builder.Services.AddHangfireServer();

// ---------------------------------------------------------------------------
// OpenAPI / Swashbuckle — kept for now so NSwag can generate the TS client
// in a later phase. The /swagger UI is on in dev only.
// ---------------------------------------------------------------------------
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ---------------------------------------------------------------------------
// CORS — SPA on a different origin, JWT cookie sent cross-origin. Must
// allow credentials with explicit origins (no `*` with credentials).
// ---------------------------------------------------------------------------
var configuredOrigins = builder.Configuration["CORS_ALLOWED_ORIGINS"];
var allowedOrigins = string.IsNullOrWhiteSpace(configuredOrigins)
    ? new[]
    {
        "http://localhost:3000",  // next dev
        "http://localhost:8080",  // standalone frontend compose
    }
    : configuredOrigins
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddCors(opt => opt.AddDefaultPolicy(p => p
    .WithOrigins(allowedOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .AllowCredentials()));

var app = builder.Build();

// ---------------------------------------------------------------------------
// Apply pending EF migrations on boot. Simpler than a separate `dotnet ef
// database update` step in the Dockerfile entrypoint, at the cost of every
// container racing to apply migrations on first boot — Postgres advisory
// locks inside EF's migration applier serialise them safely.
// ---------------------------------------------------------------------------
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<TimeFlowDbContext>();
    await db.Database.MigrateAsync();
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// Hangfire dashboard at /hangfire — locked to Owner role behind the cookie
// auth scheme.
app.UseHangfireDashboard("/hangfire", new DashboardOptions
{
    Authorization = new[] { new HangfireOwnerDashboardFilter() },
});

// Health check (anonymous, no rate limit).
app.MapGet("/api/health", HealthEndpoint.Handle).AllowAnonymous();

// Dev-only smoke + seed endpoints. Mapped only when DEV_SMOKE=1, so
// production envs never expose them.
if (string.Equals(builder.Configuration["DEV_SMOKE"], "1", StringComparison.Ordinal)) {
    app.MapGet("/api/_dev/phase4-smoke", Phase4SmokeEndpoint.Handle).AllowAnonymous();
    // Phase 8: bypass Verify so we can drive the sync worker against a
    // credential that's guaranteed to fail upstream (proves the failure
    // path of the pipeline).
    app.MapPost("/api/_dev/seed-integration", Phase8SeedEndpoint.Handle).RequireAuthorization();
}

// Auth + account routes (Phase 3).
app.MapAuthEndpoints();
app.MapAccountEndpoints();

// Org + member + project-member + policy routes. Squads were absorbed
// into the project tree (type='team') in the hierarchy refactor — the
// old MapSquadEndpoints registration disappears with this PR.
app.MapOrgEndpoints();
app.MapMemberEndpoints();
app.MapMemberSummaryEndpoints();
app.MapProjectMemberEndpoints();
app.MapPolicyEndpoints();
app.MapProjectPolicyEndpoints();

// Billing v1 — invoices + PDF (Client collapsed into Project).
app.MapInvoiceEndpoints();

// Native PM + reference data + schedule/holiday materialisers (Phase 6).
app.MapProjectEndpoints();
app.MapTaskEndpoints();
app.MapWorklogEndpoints();
app.MapReferenceEndpoints();
app.MapScheduleEndpoints();

// Integration connections (Phase 7).
app.MapIntegrationEndpoints();

// Hangfire-backed sync triggers + status (Phase 8).
app.MapSyncEndpoints();

// Cross-connection task browse (Phase 4 of the scale work).
app.MapTasksMeEndpoints();

// Manager+ org-wide tasks browse with create/update + upstream CRUD push.
app.MapTasksAllEndpoints();

// AI streaming surfaces (Phase 9).
app.MapAiEndpoints();

// Reports + CSV exports (Phase 11).
app.MapReportEndpoints();

app.Run();
