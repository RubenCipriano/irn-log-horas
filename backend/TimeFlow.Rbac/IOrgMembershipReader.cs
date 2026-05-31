namespace TimeFlow.Rbac;

// Bridge between the auth identity (sub claim → userId) and the per-org
// role table. Defined here so the RequireOrgPermission filter doesn't
// need to know about EF Core; the API project implements it against
// `org_memberships` once that table lands in Phase 5.
//
// Implementations SHOULD cache aggressively — every authed request hits
// this — but MUST invalidate on `member.role_changed`, `member.removed`,
// and `member.added` audit events. Use `org:{orgId}:members` as the
// cache-aside tag (same convention CLAUDE.md mandates).
public interface IOrgMembershipReader {
    /// <summary>Resolve the user's role in the org. Null = not a member.</summary>
    Task<OrgRole?> GetRoleAsync(Guid userId, Guid orgId, CancellationToken ct = default);
}
