using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using TimeFlow.Data.Models;

namespace TimeFlow.Auth;

// Single source of truth for the claim shape carried in the JWT. Keeping
// it here (rather than scattered across endpoint files) means we can
// change the claim layout in one place when org membership lands in
// Phase 5.
public static class AuthClaims {
    public const string EmailClaim = "email";
    public const string NameClaim = "name";
    public const string LandingOrgClaim = "lord";

    /// <summary>Build the claim set we want in every token for this user.</summary>
    public static IEnumerable<Claim> For(User user) {
        yield return new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString());
        yield return new Claim(EmailClaim, user.Email);
        if (!string.IsNullOrEmpty(user.Name)) {
            yield return new Claim(NameClaim, user.Name);
        }
    }

    /// <summary>Extract the user id (sub claim) from an authenticated principal.</summary>
    public static Guid? GetUserId(ClaimsPrincipal principal) {
        var sub = principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
            ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(sub, out var id) ? id : null;
    }
}
