namespace TimeFlow.Data.Models;

// A native-project ↔ user allocation. Composite PK on `(project_id,
// user_id)` so a member is either allocated to a project or not — no
// double-counting. The `org_id` mirror lets queries scope without joining
// `native_projects` (same pattern `Worklog.OrgId` uses).
//
// `CostPerHour` is an OPTIONAL override of the member's org-level rate
// (see `OrgMembership.CostPerHour`). Null = "use the org rate." The
// hours-summary endpoint cascades override → org rate when computing cost.
//
// `AllocatedBy` is ON DELETE SET NULL so a GDPR delete doesn't fail the
// FK and audit history stays in place, anonymised.
//
// Note: upstream projects are NOT modelled here. Allocation is native-
// projects only — upstream connections mirror an external tracker which
// has its own member model.
public sealed class ProjectMember {
    public Guid ProjectId { get; set; }
    public Guid UserId { get; set; }
    public Guid OrgId { get; set; }

    /// <summary>Optional override of the org-level cost rate. Null = use org rate.</summary>
    public decimal? CostPerHour { get; set; }

    /// <summary>
    /// Role this user holds on the project. One of
    /// `viewer | developer | tech_lead | manager`. Drives effective access
    /// per I1/I2 — the EFFECTIVE role at any project P is the role on the
    /// NEAREST `project_members` row found while walking ancestors (no
    /// "max across the path" rule). Defaults to `developer` for backward
    /// compatibility with existing rows.
    /// </summary>
    public string RoleOnProject { get; set; } = "developer";

    /// <summary>
    /// When true, this row BLOCKS the user from inheriting access through
    /// ancestors at this exact project. A deeper explicit `denied=false`
    /// row overrides this (nearest-ancestor-wins per I1). When `denied`
    /// is true, `CostPerHour` is enforced null at the app layer.
    /// </summary>
    public bool Denied { get; set; }

    public DateTime AllocatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>SET NULL on user delete (GDPR cascade).</summary>
    public Guid? AllocatedBy { get; set; }

    // Nav
    public NativeProject? Project { get; set; }
    public User? User { get; set; }
}
