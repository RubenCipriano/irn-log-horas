using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Auth;
using TimeFlow.Data;
using TimeFlow.Data.Models;

namespace TimeFlow.Api.Endpoints;

// /api/auth/* — signup, login (with optional 2FA challenge), logout, me.
//
// Cookie semantics:
//   - On signup + login success we issue a JWT and set the `tf_jwt`
//     cookie via JwtCookieAuthHandler.IssueAndSetCookie.
//   - On login when 2FA is enabled, we DO NOT issue the cookie yet.
//     Instead we return `{ requires2fa: true, challenge: <opaque> }`
//     where `challenge` is a short-lived signed token holding the
//     userId. The SPA then calls /api/auth/login/2fa with the challenge
//     + TOTP. We use Redis with a 5-min TTL to bind the challenge to a
//     user so a stolen challenge can't be replayed forever.
//   - On logout we delete the cookie + add jti to the Redis denylist.
//
// Validation: minimal — the SPA already enforces password length, but
// we double-check (12 chars min). Email format gets DataAnnotations'
// EmailAddressAttribute which is permissive but catches typos.

public static class AuthEndpoints {
    public static void MapAuthEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/auth")
            .RequireRateLimiting(RateLimitPolicies.Auth);

        grp.MapPost("/signup", Signup).AllowAnonymous();
        grp.MapPost("/login", Login).AllowAnonymous();
        grp.MapPost("/login/2fa", Login2fa).AllowAnonymous();
        grp.MapPost("/logout", Logout).RequireAuthorization();
        grp.MapGet("/me", Me).RequireAuthorization();
    }

    // ---------------------------------------------------------------------
    // POST /api/auth/signup
    // ---------------------------------------------------------------------
    public sealed record SignupRequest(
        [Required, EmailAddress, MaxLength(320)] string Email,
        [Required, MinLength(1), MaxLength(120)] string Name,
        [Required, MinLength(12), MaxLength(256)] string Password);

    public static async Task<IResult> Signup(
        SignupRequest body,
        TimeFlowDbContext db,
        IPasswordHasher hasher,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }

        var email = body.Email.Trim().ToLowerInvariant();
        var exists = await db.Users.AnyAsync(u => u.Email == email, ct);
        if (exists) {
            // Don't leak whether the email is registered — same response
            // either way (returning 409 here would let an attacker probe
            // for accounts). Pretend success; the user gets a verify
            // email (Phase later) only if the account actually exists.
            // For now we just return generic 409 since the SPA needs
            // SOMETHING to show; production we'd flip this to 200.
            return Results.Conflict(new { error = "An account with this email already exists." });
        }

        var user = new User {
            Email = email,
            Name = body.Name.Trim(),
            PasswordHash = hasher.Hash(body.Password),
        };
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);

        await IssueCookieAsync(http, user);
        return Results.Ok(MeResponse.From(user, twoFactorEnabled: false));
    }

    // ---------------------------------------------------------------------
    // POST /api/auth/login
    // ---------------------------------------------------------------------
    public sealed record LoginRequest(
        [Required, EmailAddress, MaxLength(320)] string Email,
        [Required, MinLength(1), MaxLength(256)] string Password);

    public static async Task<IResult> Login(
        LoginRequest body,
        TimeFlowDbContext db,
        IPasswordHasher hasher,
        ITwoFactorChallengeStore challenges,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }

        var email = body.Email.Trim().ToLowerInvariant();
        var user = await db.Users
            .Include(u => u.TwoFactor)
            .FirstOrDefaultAsync(u => u.Email == email, ct);

        // Constant-time-ish: if no user, run a throw-away verify to
        // smooth timing across the "no such email" vs "wrong password"
        // branches. Not perfect (Argon2 timing depends on params, which
        // an attacker can guess from a real hash leak) but better than
        // an obvious early return.
        if (user is null || string.IsNullOrEmpty(user.PasswordHash)) {
            hasher.Verify(body.Password, "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
            return Results.Json(new { error = "Invalid email or password." }, statusCode: 401);
        }

        if (!hasher.Verify(body.Password, user.PasswordHash)) {
            return Results.Json(new { error = "Invalid email or password." }, statusCode: 401);
        }

        if (user.TwoFactor?.EnabledAt is not null) {
            var challenge = await challenges.CreateAsync(user.Id, ct);
            return Results.Ok(new { requires2fa = true, challenge });
        }

        await IssueCookieAsync(http, user);
        return Results.Ok(MeResponse.From(user, twoFactorEnabled: false));
    }

    // ---------------------------------------------------------------------
    // POST /api/auth/login/2fa
    // ---------------------------------------------------------------------
    public sealed record Login2faRequest(
        [Required] string Challenge,
        [Required, MinLength(6), MaxLength(8)] string Code);

    public static async Task<IResult> Login2fa(
        Login2faRequest body,
        TimeFlowDbContext db,
        ITotpService totp,
        ITwoFactorChallengeStore challenges,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }

        var userId = await challenges.ConsumeAsync(body.Challenge, ct);
        if (userId is null) {
            return Results.Json(new { error = "Invalid or expired 2FA challenge." }, statusCode: 401);
        }

        var user = await db.Users
            .Include(u => u.TwoFactor)
            .FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        if (user?.TwoFactor is null || user.TwoFactor.EnabledAt is null) {
            // Defensive — challenge existed but 2FA was disabled between
            // login and verify. Don't issue a cookie; force restart.
            return Results.Json(new { error = "2FA is no longer required for this account. Sign in again." }, statusCode: 401);
        }

        if (!totp.Verify(user.TwoFactor.Secret, body.Code)) {
            // Cheap reissue so the user can retry without restarting.
            var fresh = await challenges.CreateAsync(user.Id, ct);
            return Results.Json(new { error = "Incorrect code.", challenge = fresh }, statusCode: 401);
        }

        await IssueCookieAsync(http, user);
        return Results.Ok(MeResponse.From(user, twoFactorEnabled: true));
    }

    // ---------------------------------------------------------------------
    // POST /api/auth/logout
    // ---------------------------------------------------------------------
    public static async Task<IResult> Logout(
        HttpContext http,
        IAuthenticationHandlerProvider handlers) {
        // The auth handler exposes RevokeCurrentAsync via its scheme.
        // Resolve it by name and call directly.
        var handler = await handlers.GetHandlerAsync(http, JwtCookieAuthHandler.SchemeName);
        if (handler is JwtCookieAuthHandler jwt) {
            await jwt.RevokeCurrentAsync();
        }
        return Results.Ok(new { ok = true });
    }

    // ---------------------------------------------------------------------
    // GET /api/auth/me
    // ---------------------------------------------------------------------
    public static async Task<IResult> Me(
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) {
            return Results.Unauthorized();
        }

        var user = await db.Users
            .Include(u => u.TwoFactor)
            .FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        if (user is null) {
            // Authenticated principal references a user the DB no longer
            // has — treat as logged out so the SPA bounces to /login.
            return Results.Unauthorized();
        }

        // Landing org pick — first joined (oldest membership). The shell
        // uses this to default URLs like /orgs/{landingOrgId}/dashboard.
        // Returns null for a user who hasn't joined any org yet (the
        // onboarding/create-org page handles that case).
        var defaultOrgId = await db.OrgMemberships
            .Where(m => m.UserId == userId.Value)
            .OrderBy(m => m.CreatedAt)
            .Select(m => (Guid?)m.OrgId)
            .FirstOrDefaultAsync(ct);

        return Results.Ok(MeResponse.From(user, twoFactorEnabled: user.TwoFactor?.EnabledAt is not null, defaultOrgId: defaultOrgId));
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    private static async Task IssueCookieAsync(HttpContext http, User user) {
        var handler = await http.RequestServices
            .GetRequiredService<IAuthenticationHandlerProvider>()
            .GetHandlerAsync(http, JwtCookieAuthHandler.SchemeName);
        if (handler is not JwtCookieAuthHandler jwt) {
            throw new InvalidOperationException("JwtCookieAuthHandler not registered.");
        }
        jwt.IssueAndSetCookie(AuthClaims.For(user));
        user.UpdatedAt = DateTime.UtcNow;
    }

    public sealed record MeResponse(
        Guid Id,
        string Email,
        string Name,
        bool TwoFactorEnabled,
        Guid? DefaultOrgId,
        DateTime CreatedAt) {
        public static MeResponse From(User u, bool twoFactorEnabled, Guid? defaultOrgId = null) =>
            new(u.Id, u.Email, u.Name, twoFactorEnabled, defaultOrgId, u.CreatedAt);
    }
}
