namespace TimeFlow.Rbac;

// The single source of truth for "which role gets which capability."
// Read top-to-bottom: each row lists the lowest role that gets it; every
// role above inherits. (So `OrgRead = Viewer` means everyone gets it.)
//
// Special cases the matrix can't express get bespoke checks at the call
// site — for example, the GitLab "see own" gate also needs to know that
// the user is asking about THEIR OWN commits, not someone else's.
public static class PermissionMatrix {
    private static readonly Dictionary<Permission, OrgRole> Minimum = new() {
        // Org-level
        [Permission.OrgRead] = OrgRole.Viewer,
        [Permission.OrgUpdate] = OrgRole.Admin,
        [Permission.OrgDelete] = OrgRole.Owner,
        [Permission.OrgTransferOwnership] = OrgRole.Owner,

        // Members
        // Manager+ can invite / remove / change roles BUT only on members
        // whose current role is strictly below their own. That second check
        // (the "actor outranks target" rule) lives in OrgRoleHierarchy and
        // is applied inside MemberEndpoints — the matrix only gates the
        // baseline permission to perform the action at all.
        [Permission.MembersRead] = OrgRole.Viewer,
        [Permission.MembersInvite] = OrgRole.Manager,
        [Permission.MembersRemove] = OrgRole.Manager,
        [Permission.MembersAssignRoles] = OrgRole.Manager,
        // Cost rate is HR-adjacent — gated separately so a future tightening
        // (e.g. owner-only) is one matrix entry away.
        [Permission.MembersUpdateCost] = OrgRole.Manager,

        // Squads
        [Permission.SquadsRead] = OrgRole.Viewer,
        [Permission.SquadsManage] = OrgRole.Manager,

        // Native PM
        [Permission.ProjectsRead] = OrgRole.Viewer,
        [Permission.ProjectsWrite] = OrgRole.TechLead,
        [Permission.TasksRead] = OrgRole.Viewer,
        [Permission.TasksWrite] = OrgRole.Developer,
        // Org-wide tasks browse + write — Manager+ for the new /tasks page
        // that crosses native + upstream and allows pushing CRUD back to
        // OpenProject. Developers stay on /tasks/me and per-project views.
        [Permission.TasksReadOrg] = OrgRole.Manager,
        [Permission.TasksWriteOrg] = OrgRole.Manager,

        // Worklogs
        [Permission.WorklogsReadOwn] = OrgRole.Developer,
        [Permission.WorklogsReadSquad] = OrgRole.TechLead,
        [Permission.WorklogsReadOrg] = OrgRole.Manager,
        [Permission.WorklogsWriteOwn] = OrgRole.Developer,
        [Permission.WorklogsApproveSquad] = OrgRole.TechLead,
        [Permission.WorklogsApproveOrg] = OrgRole.Manager,

        // Integrations
        // Read = list visible connections; Create = add your own; Configure
        // = admin-level governance (sees every connection, can act on them
        // regardless of CreatedBy). Per-user ownership is enforced at the
        // endpoint via assertOwnerOrAdmin, not via the matrix.
        [Permission.IntegrationsConfigure] = OrgRole.Admin,
        [Permission.IntegrationsRead] = OrgRole.Viewer,
        [Permission.IntegrationsCreate] = OrgRole.Developer,

        // Billing
        [Permission.BillingRead] = OrgRole.Manager,
        [Permission.BillingExport] = OrgRole.Manager,
        // Clients + Invoices (Billing v1). Manager+ for both read and
        // write so the freelancer-owner who runs the org can manage their
        // own billing without needing admin escalation.
        [Permission.ClientsRead] = OrgRole.Manager,
        [Permission.ClientsWrite] = OrgRole.Manager,
        [Permission.InvoicesRead] = OrgRole.Manager,
        [Permission.InvoicesWrite] = OrgRole.Manager,

        // GitLab — matches the table in CLAUDE.md
        [Permission.GitlabSeeOwn] = OrgRole.Developer,
        [Permission.GitlabSeeSquad] = OrgRole.TechLead,
        [Permission.GitlabSeeOrg] = OrgRole.Admin,
        [Permission.GitlabConfigure] = OrgRole.Admin,

        // AI
        [Permission.AiUse] = OrgRole.Developer,
        [Permission.AiConfigure] = OrgRole.Admin,

        // Audit + ops
        [Permission.AuditRead] = OrgRole.Admin,
        [Permission.HangfireDashboard] = OrgRole.Owner,
    };

    /// <summary>True when the given role can perform the permission.</summary>
    public static bool Can(OrgRole role, Permission permission) {
        if (!Minimum.TryGetValue(permission, out var min)) {
            // Defensive: a permission that hasn't been wired into the matrix
            // is denied to everyone. Force-fail closed.
            return false;
        }
        return role.AtLeast(min);
    }

    /// <summary>Throws <see cref="ForbiddenException"/> when the role can't.</summary>
    public static void Require(OrgRole role, Permission permission) {
        if (!Can(role, permission)) {
            throw new ForbiddenException(role, permission);
        }
    }

    /// <summary>Enumerate everything a role can do — handy for debugging + the audit log.</summary>
    public static IEnumerable<Permission> Granted(OrgRole role) =>
        Minimum.Where(kv => role.AtLeast(kv.Value)).Select(kv => kv.Key);
}

/// <summary>Thrown by <see cref="PermissionMatrix.Require"/> on denial.</summary>
public sealed class ForbiddenException : Exception {
    public OrgRole Role { get; }
    public Permission Permission { get; }

    public ForbiddenException(OrgRole role, Permission permission)
        : base($"Role '{role.ToWire()}' lacks permission '{permission.ToWire()}'.") {
        Role = role;
        Permission = permission;
    }
}
