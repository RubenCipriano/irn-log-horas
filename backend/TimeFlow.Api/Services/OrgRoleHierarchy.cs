using TimeFlow.Rbac;

namespace TimeFlow.Api.Services;

// The role hierarchy rule: a member can only act on rows whose role is
// STRICTLY below their own. Manager (4) can affect TechLead (3), Developer
// (2), Viewer (1); cannot affect another Manager, an Admin (5), or the
// Owner (6). Admin can affect everyone below Admin; Owner has no ceiling.
//
// The matrix (PermissionMatrix.cs) gates "can this role perform Add /
// Remove / ChangeRole AT ALL"; this helper enforces "and only on a
// target whose current role is below the actor's."
//
// Owner-touching keeps its own dedicated rule in MemberEndpoints — only
// Owner can grant / remove / demote an Owner. That equal-rank Owner-on-
// Owner case is the one exception, handled at the call site.
public static class OrgRoleHierarchy {
    /// <summary>
    /// True when the actor strictly outranks the target role. Use to gate
    /// invite / change-role / remove — Manager can act on TechLead but
    /// not on another Manager.
    /// </summary>
    public static bool Outranks(OrgRole actor, OrgRole target) =>
        (int)actor > (int)target;
}
