namespace TimeFlow.Rbac;

// Org-scoped role enum. Ranks ascend: Viewer < Developer < TechLead <
// Manager < Admin < Owner. The numeric values are NOT persisted — we
// store the role as the lower-case name (`"owner"`, `"developer"`) on
// `org_memberships.role`, and `Parse`/`ToWire` convert. Keeping the
// enum out of the wire format means renumbering can't corrupt the DB.
public enum OrgRole {
    Viewer = 1,
    Developer = 2,
    TechLead = 3,
    Manager = 4,
    Admin = 5,
    Owner = 6,
}

public static class OrgRoleExtensions {
    /// <summary>Lower-case canonical name for DB + JWT storage.</summary>
    public static string ToWire(this OrgRole role) => role switch {
        OrgRole.Viewer => "viewer",
        OrgRole.Developer => "developer",
        OrgRole.TechLead => "tech_lead",
        OrgRole.Manager => "manager",
        OrgRole.Admin => "admin",
        OrgRole.Owner => "owner",
        _ => throw new ArgumentOutOfRangeException(nameof(role), role, null),
    };

    /// <summary>Parse the wire form. Returns null on unknown values.</summary>
    public static OrgRole? FromWire(string? wire) => wire switch {
        "viewer" => OrgRole.Viewer,
        "developer" => OrgRole.Developer,
        "tech_lead" => OrgRole.TechLead,
        "manager" => OrgRole.Manager,
        "admin" => OrgRole.Admin,
        "owner" => OrgRole.Owner,
        _ => null,
    };

    /// <summary>True when this role is at least as senior as `min`.</summary>
    public static bool AtLeast(this OrgRole role, OrgRole min) => (int)role >= (int)min;
}
