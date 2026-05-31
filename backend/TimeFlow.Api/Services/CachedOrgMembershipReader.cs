using Microsoft.EntityFrameworkCore;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Services;

// Cached implementation of the Phase 4 reader interface. Every authed
// request hits this through RequireOrgPermission, so a Postgres round-
// trip per check is too expensive — we cache the (userId, orgId) → role
// mapping under the `org:{orgId}:members` tag so a single role change
// drops every cached role lookup for that org in one Redis batch.
//
// Cache key: `member:{userId}:{orgId}` (a string, NOT json — Redis will
// store the wire role like "owner" / null-marker).
//
// TTL: 5 minutes. Even if invalidation is missed for some reason, the
// stale role can never outlive that window — bounded blast radius.
public sealed class CachedOrgMembershipReader : IOrgMembershipReader {
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(2);
    // Sentinel for "user is not a member of this org" — stored so
    // negative lookups don't keep hitting Postgres.
    private const string NotMemberMarker = "__not_member__";

    private readonly TimeFlowDbContext _db;
    private readonly ICacheStore _cache;

    public CachedOrgMembershipReader(TimeFlowDbContext db, ICacheStore cache) {
        _db = db;
        _cache = cache;
    }

    public async Task<OrgRole?> GetRoleAsync(Guid userId, Guid orgId, CancellationToken ct = default) {
        var key = $"member:{userId:N}:{orgId:N}";
        var tag = MembershipCacheTags.OrgMembers(orgId);

        var wire = await _cache.GetOrSetAsync(
            key,
            Ttl,
            new[] { tag, MembershipCacheTags.UserOrgs(userId) },
            async ct2 => {
                var role = await _db.OrgMemberships
                    .Where(m => m.UserId == userId && m.OrgId == orgId)
                    .Select(m => m.Role)
                    .FirstOrDefaultAsync(ct2);
                return role ?? NotMemberMarker;
            },
            ct);

        if (wire == NotMemberMarker) return null;
        return OrgRoleExtensions.FromWire(wire);
    }
}

// Centralised so endpoint code that mutates membership doesn't drift
// from the tag names this reader uses.
public static class MembershipCacheTags {
    public static string OrgMembers(Guid orgId) => $"org:{orgId:N}:members";
    public static string UserOrgs(Guid userId) => $"user:{userId:N}:orgs";
    public static string OrgMeta(Guid orgId) => $"org:{orgId:N}:meta";
    public static string OrgPolicy(Guid orgId) => $"org:{orgId:N}:policy";
    public static string OrgSquads(Guid orgId) => $"org:{orgId:N}:squads";
}
