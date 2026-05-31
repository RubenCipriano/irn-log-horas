namespace TimeFlow.Data.Models;

// A tenant. Every authenticated mutation either targets the user's own
// row OR an org-scoped resource — and org-scoped routes pass the orgId
// in the URL (`/api/orgs/{id}/...`) so RequireOrgPermission can gate.
//
// `ScheduleConfigJson` + `HolidayProfileJson` are nullable text columns
// carrying the JSON payloads defined by TimeFlow.Domain's schedule +
// holiday types. Null means "use the built-in PT-IRN defaults" — the
// same fallback the legacy stack used so existing customers aren't
// forced to re-configure.
public sealed class Organisation {
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Denormalised owner pointer set at creation and updated by /api/orgs/{id}/transfer.
    /// Nullable because GDPR user-delete fires SET NULL here; the sole-owner 409 guard
    /// is enforced via OrgMembership.Role = Owner, not this column.
    /// </summary>
    public Guid? OwnerId { get; set; }

    /// <summary>JSON serialised OrgScheduleConfig. Null = default schedule.</summary>
    public string? ScheduleConfigJson { get; set; }

    /// <summary>JSON serialised OrgHolidayProfile. Null = default holiday profile.</summary>
    public string? HolidayProfileJson { get; set; }

    /// <summary>
    /// ISO 4217 currency code (e.g. "EUR", "USD"). Single per-org currency
    /// for v1; multi-currency is roadmap H7. New invoices inherit this.
    /// </summary>
    public string Currency { get; set; } = "EUR";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Nav
    public User? Owner { get; set; }
    public ICollection<OrgMembership> Memberships { get; set; } = new List<OrgMembership>();
}
