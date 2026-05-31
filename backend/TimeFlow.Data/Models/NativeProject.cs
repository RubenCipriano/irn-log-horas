namespace TimeFlow.Data.Models;

// Native PM project. The engagement unit AND the invoiced party — Client
// was collapsed into this model, so the billable contact info + default
// rate now live directly on each project.
//
// `Archived` is a soft-delete flag; archived projects stay readable so
// historical worklogs still reference a valid row, but they're hidden
// from the default project picker in the UI.
//
// `Code` is an optional short identifier (e.g. "ACME-WEB") used in
// reports + AI task-matching. Unique per org when set.
public sealed class NativeProject {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrgId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Code { get; set; }
    public bool Archived { get; set; }

    /// <summary>SET NULL on user delete (GDPR cascade — preserve project history).</summary>
    public Guid? CreatedBy { get; set; }

    // Billing-party fields (absorbed from the legacy Client entity).
    public string? ContactEmail { get; set; }
    public string? ContactName { get; set; }
    public string? TaxId { get; set; }
    public string? Address { get; set; }

    /// <summary>Default rate this project's worklogs are billed at when no
    /// nearer override exists. The cascade is project_members.cost_per_hour
    /// → project.BillRate → ancestor BillRate(s) → DefaultBillRate → null.</summary>
    public decimal? DefaultBillRate { get; set; }

    /// <summary>
    /// Per-project bill-rate override. Cascade order (highest priority
    /// first) when computing invoice amounts — full cascade rule in I3:
    ///   walk ancestors → nearest non-null wins → fall back to root
    ///   project.default_bill_rate → null (warn).
    /// </summary>
    public decimal? BillRate { get; set; }

    /// <summary>
    /// Parent in the project hierarchy. NULL = root project (engagement).
    /// Mirrored upstream sub-projects use this to point back at the
    /// engagement project that owns the bringing-in connection.
    /// </summary>
    public Guid? ParentProjectId { get; set; }

    /// <summary>
    /// UX hint — "program | project | subproject | team | module | service | epic".
    /// Authz never reads this; only icons, sort, and notifications care.
    /// </summary>
    public string Type { get; set; } = "project";

    /// <summary>
    /// When this Project mirrors an upstream tracker project, the
    /// `(connection_id, upstream_project_id)` tuple is the natural key
    /// that ties this row to the upstream source. Both fields are
    /// immutable after creation — re-sync updates name/archived/etc. but
    /// not the origin.
    /// </summary>
    public Guid? ConnectionId { get; set; }
    public string? UpstreamProjectId { get; set; }

    /// <summary>Raw sync payload from the last upstream fetch (for debugging).</summary>
    public string? UpstreamRawJson { get; set; }

    /// <summary>When this row was last refreshed from upstream.</summary>
    public DateTime? LastSyncedAt { get; set; }

    /// <summary>Upstream's `updated_at` for delta sync.</summary>
    public DateTime? UpstreamUpdatedAt { get; set; }

    /// <summary>
    /// Per-project working-hours schedule (JSON serialised OrgScheduleConfig,
    /// same shape as Organisation.ScheduleConfigJson). NULL = inherit from
    /// nearest ancestor that has it set, ultimately falling back to org
    /// policy. Resolved by ProjectPolicyResolver via the ancestor walk.
    /// </summary>
    public string? ScheduleConfig { get; set; }

    /// <summary>
    /// Per-project holiday profile (JSON serialised OrgHolidayProfile, same
    /// shape as Organisation.HolidayProfileJson). NULL = inherit. The full
    /// JSON override beats the holiday_country shortcut when both are set
    /// on the same row.
    /// </summary>
    public string? HolidayProfile { get; set; }

    /// <summary>
    /// ISO-3166-1 alpha-2 country code (PT, ES, FR, IE, GB, US, ...) — a
    /// discoverable shortcut for picking a built-in holiday preset without
    /// authoring the holiday_profile JSON by hand. NULL = inherit. When
    /// resolving, holiday_profile JSON wins on the same row; across the
    /// ancestor chain, the deeper-in-the-chain source wins regardless of
    /// which column carried it.
    /// </summary>
    public string? HolidayCountry { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public Organisation? Org { get; set; }
    public NativeProject? ParentProject { get; set; }
    public IntegrationConnection? Connection { get; set; }
    public ICollection<NativeTask> Tasks { get; set; } = new List<NativeTask>();
}
