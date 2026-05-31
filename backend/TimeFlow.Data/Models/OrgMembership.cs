namespace TimeFlow.Data.Models;

// (user, org, role) triple. Composite PK on (user_id, org_id) so a user
// can be in many orgs but only once per org. `Role` is the OrgRole's
// wire form ("owner", "developer", etc.) — stored as a plain string so
// renumbering the enum can't corrupt the DB.
//
// Why no separate "invited but not joined" state: invitations live in a
// future `invites` table once email delivery is wired. For now,
// membership = joined.
public sealed class OrgMembership {
    public Guid UserId { get; set; }
    public Guid OrgId { get; set; }

    /// <summary>Lower-case wire form of OrgRole (see TimeFlow.Rbac.OrgRoleExtensions).</summary>
    public string Role { get; set; } = "viewer";

    /// <summary>
    /// Org-wide default cost rate for this member's hours. Null = "not set."
    /// Per-project rate overrides live on <see cref="ProjectMember.CostPerHour"/>.
    /// Sensitive (HR-adjacent) — API responses strip this for viewers below
    /// Manager rank.
    ///
    /// When <see cref="PayCadence"/> is "hourly" (or NULL — see below), this is
    /// the rate used by the paycheck accumulator. For "daily"/"monthly" cadences
    /// the paycheck math reads <see cref="DailyRate"/> / <see cref="MonthlyRate"/>
    /// instead and bypasses the per-project override.
    /// </summary>
    public decimal? CostPerHour { get; set; }

    /// <summary>
    /// Pay cadence selector — "hourly" | "daily" | "monthly". NULL is the
    /// legitimate backwards-compat sentinel meaning "hourly" (every row that
    /// existed before this column was added stays valid without a backfill).
    /// All three rate slots (<see cref="CostPerHour"/>, <see cref="DailyRate"/>,
    /// <see cref="MonthlyRate"/>) are persisted independently so toggling the
    /// cadence remembers prior values.
    /// </summary>
    public string? PayCadence { get; set; }

    /// <summary>
    /// Flat per-workday rate used when <see cref="PayCadence"/> is "daily".
    /// Same sensitivity bucket as <see cref="CostPerHour"/>.
    /// </summary>
    public decimal? DailyRate { get; set; }

    /// <summary>
    /// Flat monthly rate used when <see cref="PayCadence"/> is "monthly". The
    /// paycheck accumulator pro-rates this by (logged_hours / expected_hours)
    /// over the reporting window. Same sensitivity bucket as <see cref="CostPerHour"/>.
    /// </summary>
    public decimal? MonthlyRate { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Nav
    public User? User { get; set; }
    public Organisation? Org { get; set; }
}
