namespace TimeFlow.Data.Models;

// Single users table. Carries the password hash directly — no separate
// `account` table (Better Auth's legacy split made sense when SSO providers
// needed their own row; with credentials-only auth here, one row is
// enough). SSO can be reintroduced later as a sibling table without
// touching this one.
//
// Email is stored lowercase + unique-indexed. Display name is mutable.
public sealed class User
{
    /// <summary>Stable UUID; primary key.</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Lowercase, unique. The login identifier.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>Display name. Mutable. Empty allowed (account-less invite paths).</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Argon2id PHC-encoded hash, eg `$argon2id$v=19$m=65536,t=3,p=4$...$...`.
    /// Nullable so invite-only accounts (created before the invitee sets a
    /// password) can exist without a credential.
    /// </summary>
    public string? PasswordHash { get; set; }

    /// <summary>Set on the first verified-email click. Null = unverified.</summary>
    public DateTime? EmailVerifiedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Nav
    public UserTwoFactor? TwoFactor { get; set; }
}
