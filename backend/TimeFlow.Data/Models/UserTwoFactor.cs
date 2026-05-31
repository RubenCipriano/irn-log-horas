namespace TimeFlow.Data.Models;

// Separate table because most users won't enroll — keeping the secret +
// backup-code material off the hot `users` table means rows are smaller
// and the column doesn't show up in every SELECT.
//
// `UserId` is the primary key (1:1 with User). `Secret` is the base32
// TOTP seed (RFC 6238). `BackupCodes` holds bcrypt-hashed single-use
// recovery codes serialised as JSON so we don't need a separate table
// for a list that's at most 10 entries.
//
// `EnabledAt` is null while the user is mid-enrolment (secret generated,
// not yet confirmed by entering a TOTP). Set to the confirmation
// timestamp once the user proves they can read codes from their
// authenticator app.
public sealed class UserTwoFactor
{
    /// <summary>FK + PK. 1:1 with User.</summary>
    public Guid UserId { get; set; }

    /// <summary>Base32-encoded TOTP secret. Treated as sensitive — never echoed in API responses post-enrolment.</summary>
    public string Secret { get; set; } = string.Empty;

    /// <summary>JSON array of bcrypt-hashed backup codes. Empty array when none are left.</summary>
    public string BackupCodesJson { get; set; } = "[]";

    /// <summary>Null until the user confirms the TOTP works.</summary>
    public DateTime? EnabledAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Nav
    public User? User { get; set; }
}
