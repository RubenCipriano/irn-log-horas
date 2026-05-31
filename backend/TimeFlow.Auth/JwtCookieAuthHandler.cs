using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace TimeFlow.Auth;

// Custom auth handler: read JWT from HTTP-only cookie, validate signature,
// check Redis denylist for the jti, populate HttpContext.User with claims.
//
// Why JWT-in-cookie and not standard JWT bearer header:
//   - HttpOnly cookie can't be read by JS — safer against XSS than
//     localStorage-stored bearer tokens
//   - Browser auto-sends the cookie on every request without FE plumbing
//   - SPA still gets JWT benefits: claims travel with the token, no DB
//     hit for role/orgIds on every request
//   - Revocation: Redis denylist (RevokeAsync) gives us logout + admin
//     "revoke all sessions" without waiting for the 15-min token TTL
//
// Refresh strategy: a sliding cookie issuance fires on every authenticated
// request that's within 5 minutes of expiry. The handler rewrites the
// cookie with a fresh JWT before returning. No separate /refresh endpoint
// is needed — implicit refresh as long as the user is active.

public sealed class JwtCookieAuthOptions : AuthenticationSchemeOptions
{
    /// <summary>HS256 signing key (base64 OR raw, min 32 bytes after decode).</summary>
    public string Secret { get; set; } = string.Empty;
    /// <summary>Cookie name. Default `tf_jwt`.</summary>
    public string CookieName { get; set; } = "tf_jwt";
    /// <summary>Token lifetime. Default 15 min.</summary>
    public TimeSpan TokenLifetime { get; set; } = TimeSpan.FromMinutes(15);
    /// <summary>Sliding refresh window. If less than this remains, reissue.</summary>
    public TimeSpan RefreshWindow { get; set; } = TimeSpan.FromMinutes(5);
    /// <summary>Issuer claim (`iss`). Should match validation issuer.</summary>
    public string Issuer { get; set; } = "timeflow";
    /// <summary>Audience claim (`aud`).</summary>
    public string Audience { get; set; } = "timeflow-spa";
    /// <summary>True in production; false in local dev over plain HTTP.</summary>
    public bool RequireHttps { get; set; } = true;
}

public sealed class JwtCookieAuthHandler : AuthenticationHandler<JwtCookieAuthOptions>
{
    public const string SchemeName = "JwtCookie";

    private readonly IJwtRevocationStore _revocations;
    private readonly JwtSecurityTokenHandler _handler = new();

    public JwtCookieAuthHandler(
        IOptionsMonitor<JwtCookieAuthOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        IJwtRevocationStore revocations)
        : base(options, logger, encoder)
    {
        _revocations = revocations;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Cookies.TryGetValue(Options.CookieName, out var token) || string.IsNullOrWhiteSpace(token))
        {
            return AuthenticateResult.NoResult();
        }

        ClaimsPrincipal principal;
        JwtSecurityToken jwt;
        try
        {
            var validationParams = BuildValidationParameters();
            principal = _handler.ValidateToken(token, validationParams, out var validated);
            jwt = (JwtSecurityToken)validated;
        }
        catch (SecurityTokenExpiredException)
        {
            // Clear the bad cookie so the SPA stops sending it.
            Response.Cookies.Delete(Options.CookieName);
            return AuthenticateResult.Fail("Token expired");
        }
        catch (Exception ex)
        {
            Response.Cookies.Delete(Options.CookieName);
            return AuthenticateResult.Fail($"Invalid token: {ex.Message}");
        }

        var jti = jwt.Id;
        if (await _revocations.IsRevokedAsync(jti, Context.RequestAborted))
        {
            Response.Cookies.Delete(Options.CookieName);
            return AuthenticateResult.Fail("Token revoked");
        }

        // Per-user mass revocation: when the caller changed their password
        // we set a watermark on `(userId)`. Any token issued at-or-before
        // that watermark is treated as revoked. The current request's
        // freshly-issued token (post-rotation) has an `iat` AFTER the
        // watermark and passes this check; older tokens on other devices
        // do not.
        var subClaim = principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        var iatClaim = principal.FindFirstValue(JwtRegisteredClaimNames.Iat);
        if (Guid.TryParse(subClaim, out var userIdForCheck)
            && long.TryParse(iatClaim, out var iatUnix))
        {
            var iat = DateTimeOffset.FromUnixTimeSeconds(iatUnix);
            if (await _revocations.IsUserRevokedAsync(userIdForCheck, iat, Context.RequestAborted))
            {
                Response.Cookies.Delete(Options.CookieName);
                return AuthenticateResult.Fail("Token revoked (user-level)");
            }
        }

        // Sliding refresh: if the token has less than RefreshWindow remaining,
        // issue a fresh one with the same claims and rewrite the cookie. The
        // OLD jti is NOT revoked — it just naturally expires soon.
        var remaining = jwt.ValidTo - DateTime.UtcNow;
        if (remaining < Options.RefreshWindow)
        {
            var refreshed = IssueToken(principal.Claims);
            WriteCookie(refreshed);
        }

        var ticket = new AuthenticationTicket(principal, Scheme.Name);
        return AuthenticateResult.Success(ticket);
    }

    /// <summary>Issue a new JWT with the given claims and write it as the auth cookie.</summary>
    public string IssueAndSetCookie(IEnumerable<Claim> claims)
    {
        var token = IssueToken(claims);
        WriteCookie(token);
        return token;
    }

    /// <summary>Clear the auth cookie + add the current token's jti to the denylist.</summary>
    public async Task RevokeCurrentAsync()
    {
        if (Request.Cookies.TryGetValue(Options.CookieName, out var token) && !string.IsNullOrWhiteSpace(token))
        {
            try
            {
                var jwt = _handler.ReadJwtToken(token);
                await _revocations.RevokeAsync(jwt.Id, jwt.ValidTo, Context.RequestAborted);
            }
            catch
            {
                // Unparseable token — just clearing the cookie is enough.
            }
        }
        Response.Cookies.Delete(Options.CookieName);
    }

    private string IssueToken(IEnumerable<Claim> claims)
    {
        var jti = Guid.NewGuid().ToString("N");
        var allClaims = claims
            .Where(c => c.Type != JwtRegisteredClaimNames.Jti && c.Type != JwtRegisteredClaimNames.Iat)
            .Append(new Claim(JwtRegisteredClaimNames.Jti, jti))
            .Append(new Claim(JwtRegisteredClaimNames.Iat,
                DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(),
                ClaimValueTypes.Integer64));
        var key = new SymmetricSecurityKey(GetKeyBytes(Options.Secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer: Options.Issuer,
            audience: Options.Audience,
            claims: allClaims,
            notBefore: DateTime.UtcNow,
            expires: DateTime.UtcNow.Add(Options.TokenLifetime),
            signingCredentials: creds);
        return _handler.WriteToken(token);
    }

    private void WriteCookie(string token)
    {
        Response.Cookies.Append(Options.CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            Secure = Options.RequireHttps,
            SameSite = SameSiteMode.Lax, // Lax so OAuth-style redirects still send the cookie.
            Path = "/",
            // Cookie itself lives slightly longer than the token to allow the
            // last sliding-refresh request to succeed; expired tokens still
            // 401 because validation rejects them.
            Expires = DateTimeOffset.UtcNow.Add(Options.TokenLifetime).AddMinutes(5),
        });
    }

    private TokenValidationParameters BuildValidationParameters() => new()
    {
        ValidateIssuer = true,
        ValidIssuer = Options.Issuer,
        ValidateAudience = true,
        ValidAudience = Options.Audience,
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromSeconds(30),
        ValidateIssuerSigningKey = true,
        // Pin HS256 so a forged token can't downgrade the alg (or claim "none")
        // and bypass signature validation — we only ever issue HS256.
        ValidAlgorithms = new[] { SecurityAlgorithms.HmacSha256 },
        IssuerSigningKey = new SymmetricSecurityKey(GetKeyBytes(Options.Secret)),
        NameClaimType = JwtRegisteredClaimNames.Sub,
        RoleClaimType = ClaimTypes.Role,
    };

    private static byte[] GetKeyBytes(string secret)
    {
        if (string.IsNullOrWhiteSpace(secret))
            throw new InvalidOperationException("JWT secret is empty. Set JWT_SECRET (>= 32 bytes after base64-decode).");
        try
        {
            var bytes = Convert.FromBase64String(secret);
            if (bytes.Length >= 32) return bytes;
        }
        catch (FormatException)
        {
            // Not base64 — fall through and use raw bytes below.
        }
        return Encoding.UTF8.GetBytes(secret);
    }
}
