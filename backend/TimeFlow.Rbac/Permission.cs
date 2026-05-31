namespace TimeFlow.Rbac;

// Every gated capability in the app. New permissions slot into an
// existing namespace where possible (org.*, members.*, projects.*,
// worklogs.*, integrations.*, billing.*, gitlab.*, ai.*).
//
// String form is used inside JWT custom claims, audit-log entries, and
// the `Can()` matrix — keep the strings short, dotted, and stable.
public enum Permission {
    // Org-level
    OrgRead,
    OrgUpdate,
    OrgDelete,
    OrgTransferOwnership,

    // Members
    MembersRead,
    MembersInvite,
    MembersRemove,
    MembersAssignRoles,
    MembersUpdateCost,

    // Squads
    SquadsRead,
    SquadsManage,

    // Native PM
    ProjectsRead,
    ProjectsWrite,
    TasksRead,
    TasksWrite,
    TasksReadOrg,
    TasksWriteOrg,

    // Worklogs (own / squad / org)
    WorklogsReadOwn,
    WorklogsReadSquad,
    WorklogsReadOrg,
    WorklogsWriteOwn,
    WorklogsApproveSquad,
    WorklogsApproveOrg,

    // Integrations
    IntegrationsConfigure,
    IntegrationsRead,
    IntegrationsCreate,

    // Billing reports
    BillingRead,
    BillingExport,

    // Clients + Invoices (Billing v1)
    ClientsRead,
    ClientsWrite,
    InvoicesRead,
    InvoicesWrite,

    // GitLab (per the CLAUDE.md matrix)
    GitlabSeeOwn,
    GitlabSeeSquad,
    GitlabSeeOrg,
    GitlabConfigure,

    // AI surfaces
    AiUse,
    AiConfigure,

    // Settings / audit
    AuditRead,
    HangfireDashboard,
}

public static class PermissionExtensions {
    /// <summary>Dotted lower-case form used for audit + claims.</summary>
    public static string ToWire(this Permission p) => p switch {
        Permission.OrgRead => "org.read",
        Permission.OrgUpdate => "org.update",
        Permission.OrgDelete => "org.delete",
        Permission.OrgTransferOwnership => "org.transfer_ownership",
        Permission.MembersRead => "members.read",
        Permission.MembersInvite => "members.invite",
        Permission.MembersRemove => "members.remove",
        Permission.MembersAssignRoles => "members.assign_roles",
        Permission.MembersUpdateCost => "members.update_cost",
        Permission.SquadsRead => "squads.read",
        Permission.SquadsManage => "squads.manage",
        Permission.ProjectsRead => "projects.read",
        Permission.ProjectsWrite => "projects.write",
        Permission.TasksRead => "tasks.read",
        Permission.TasksWrite => "tasks.write",
        Permission.TasksReadOrg => "tasks.read_org",
        Permission.TasksWriteOrg => "tasks.write_org",
        Permission.WorklogsReadOwn => "worklogs.read_own",
        Permission.WorklogsReadSquad => "worklogs.read_squad",
        Permission.WorklogsReadOrg => "worklogs.read_org",
        Permission.WorklogsWriteOwn => "worklogs.write_own",
        Permission.WorklogsApproveSquad => "worklogs.approve_squad",
        Permission.WorklogsApproveOrg => "worklogs.approve_org",
        Permission.IntegrationsConfigure => "integrations.configure",
        Permission.IntegrationsRead => "integrations.read",
        Permission.IntegrationsCreate => "integrations.create",
        Permission.BillingRead => "billing.read",
        Permission.BillingExport => "billing.export",
        Permission.ClientsRead => "clients.read",
        Permission.ClientsWrite => "clients.write",
        Permission.InvoicesRead => "invoices.read",
        Permission.InvoicesWrite => "invoices.write",
        Permission.GitlabSeeOwn => "gitlab.see_own",
        Permission.GitlabSeeSquad => "gitlab.see_squad",
        Permission.GitlabSeeOrg => "gitlab.see_org",
        Permission.GitlabConfigure => "gitlab.configure",
        Permission.AiUse => "ai.use",
        Permission.AiConfigure => "ai.configure",
        Permission.AuditRead => "audit.read",
        Permission.HangfireDashboard => "hangfire.dashboard",
        _ => throw new ArgumentOutOfRangeException(nameof(p), p, null),
    };
}
