using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Data;
using TimeFlow.Data.Models;

namespace TimeFlow.Api.Endpoints;

// /api/account/* — authenticated mutations on the signed-in user's own
// row. All require the user's current cookie; no admin-on-behalf-of
// surface here (that lives under /api/orgs/[id]/members in Phase 5).
//
// Rate-limit policy: same bucket as auth (30/60s). Brute-forcing the
// change-password flow needs to be just as hard as brute-forcing login.

public static class AccountEndpoints {
    public static void MapAccountEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/account")
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Auth);

        grp.MapPost("/change-password", ChangePassword);
        grp.MapPost("/2fa/enroll", EnrollTwoFactor);
        grp.MapPost("/2fa/verify", VerifyTwoFactor);
        grp.MapPost("/2fa/disable", DisableTwoFactor);
    }

    // ---------------------------------------------------------------------
    // POST /api/account/change-password
    // ---------------------------------------------------------------------
    public sealed record ChangePasswordRequest(
        [Required, MinLength(1)] string CurrentPassword,
        [Required, MinLength(12), MaxLength(256)] string NewPassword);

    public static async Task<IResult> ChangePassword(
        ChangePasswordRequest body,
        TimeFlowDbContext db,
        IPasswordHasher hasher,
        IJwtRevocationStore revocations,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }

        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        if (user?.PasswordHash is null) return Results.Unauthorized();

        if (!hasher.Verify(body.CurrentPassword, user.PasswordHash)) {
            await audit.RecordAsync("account.password_change_failed", null, userId,
                payload: new { reason = "current_mismatch" }, ct: ct);
            return Results.Json(new { error = "Current password is incorrect." }, statusCode: 401);
        }

        if (hasher.Verify(body.NewPassword, user.PasswordHash)) {
            return Results.Json(new { error = "New password must differ from the current one." }, statusCode: 400);
        }

        user.PasswordHash = hasher.Hash(body.NewPassword);
        user.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        // Mass-revoke every OTHER outstanding token by setting a per-user
        // watermark just before the caller's own `iat`. Any token issued
        // before the caller's current session is invalidated on its next
        // request; the caller's current cookie survives because its `iat`
        // is strictly greater. TTL on the watermark = 1 hour (comfortably
        // longer than the 15-min token lifetime).
        long callerIat = 0;
        if (long.TryParse(http.User.FindFirstValue(JwtRegisteredClaimNames.Iat), out var parsedIat)) {
            callerIat = parsedIat;
        }
        var watermark = callerIat > 0
            ? DateTimeOffset.FromUnixTimeSeconds(callerIat - 1)
            : DateTimeOffset.UtcNow.AddSeconds(-1);
        await revocations.RevokeAllForUserAsync(userId.Value, watermark, TimeSpan.FromHours(1), ct);

        await audit.RecordAsync("account.password_changed", null, userId, ct: ct);

        return Results.Ok(new { ok = true });
    }

    // ---------------------------------------------------------------------
    // POST /api/account/2fa/enroll
    // Generates a fresh TOTP secret + returns the otpauth:// URI so the
    // SPA can render a QR code. Does NOT enable 2FA — that needs a
    // subsequent /verify call with a code derived from the secret.
    // ---------------------------------------------------------------------
    public static async Task<IResult> EnrollTwoFactor(
        TimeFlowDbContext db,
        ITotpService totp,
        HttpContext http,
        CancellationToken ct) {
        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        var user = await db.Users
            .Include(u => u.TwoFactor)
            .FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        if (user is null) return Results.Unauthorized();

        if (user.TwoFactor?.EnabledAt is not null) {
            return Results.Json(new { error = "Two-factor is already enabled. Disable it before re-enrolling." }, statusCode: 409);
        }

        var secret = totp.NewSecret();
        var uri = totp.FormatUri(secret, user.Email);

        // Upsert pending enrolment. Overwrites any prior abandoned attempt.
        if (user.TwoFactor is null) {
            db.UserTwoFactors.Add(new UserTwoFactor {
                UserId = user.Id,
                Secret = secret,
                BackupCodesJson = "[]",
                EnabledAt = null,
            });
        } else {
            user.TwoFactor.Secret = secret;
            user.TwoFactor.BackupCodesJson = "[]";
            user.TwoFactor.EnabledAt = null;
            user.TwoFactor.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(ct);

        return Results.Ok(new { secret, uri });
    }

    // ---------------------------------------------------------------------
    // POST /api/account/2fa/verify
    // Confirms the user can read codes from their authenticator app.
    // Sets EnabledAt and returns a fresh batch of one-time backup codes.
    // ---------------------------------------------------------------------
    public sealed record VerifyTwoFactorRequest(
        [Required, MinLength(6), MaxLength(8)] string Code);

    public static async Task<IResult> VerifyTwoFactor(
        VerifyTwoFactorRequest body,
        TimeFlowDbContext db,
        ITotpService totp,
        IPasswordHasher hasher,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }

        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        var tf = await db.UserTwoFactors.FirstOrDefaultAsync(t => t.UserId == userId.Value, ct);
        if (tf is null) {
            return Results.Json(new { error = "No pending enrolment. Call /enroll first." }, statusCode: 400);
        }

        if (!totp.Verify(tf.Secret, body.Code)) {
            return Results.Json(new { error = "Incorrect code." }, statusCode: 400);
        }

        // 10 one-use backup codes: 10 hex chars each (~40 bits entropy).
        // Hashed with the same Argon2 helper so a DB dump doesn't reveal
        // them — same trade-off as passwords.
        var codes = Enumerable.Range(0, 10)
            .Select(_ => Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(5)).ToLowerInvariant())
            .ToArray();
        var hashedCodes = codes.Select(c => hasher.Hash(c)).ToArray();

        tf.EnabledAt = DateTime.UtcNow;
        tf.BackupCodesJson = JsonSerializer.Serialize(hashedCodes);
        tf.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        return Results.Ok(new { enabled = true, backupCodes = codes });
    }

    // ---------------------------------------------------------------------
    // POST /api/account/2fa/disable
    // ---------------------------------------------------------------------
    public sealed record DisableTwoFactorRequest(
        [Required, MinLength(1)] string Password);

    public static async Task<IResult> DisableTwoFactor(
        DisableTwoFactorRequest body,
        TimeFlowDbContext db,
        IPasswordHasher hasher,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }

        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        var user = await db.Users
            .Include(u => u.TwoFactor)
            .FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        if (user?.PasswordHash is null) return Results.Unauthorized();

        if (!hasher.Verify(body.Password, user.PasswordHash)) {
            return Results.Json(new { error = "Password is incorrect." }, statusCode: 401);
        }

        if (user.TwoFactor is not null) {
            db.UserTwoFactors.Remove(user.TwoFactor);
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(new { ok = true });
    }
}
