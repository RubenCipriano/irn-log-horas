using Microsoft.EntityFrameworkCore;
using TimeFlow.Data;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Services;

// "Would removing/demoting this Owner leave the org with no Owner?"
// Used by:
//   - PATCH /api/orgs/{id}/members/{userId} (refuse Owner demotion if last)
//   - DELETE /api/orgs/{id}/members/{userId} (refuse sole-Owner remove)
//   - DELETE /api/account/delete (refuse if user is sole owner anywhere)
//
// Throws `ConflictException` so endpoints can let it bubble through
// the standard error -> HTTP mapper.
public static class OrgRoleGuard {
    /// <summary>
    /// Throws if demoting/removing the given user from the given org would
    /// leave the org without any Owner. Safe to call inside a transaction
    /// just before the change.
    /// </summary>
    public static async Task AssertNotLastOwnerAsync(
        TimeFlowDbContext db,
        Guid orgId,
        Guid userId,
        CancellationToken ct = default) {
        var thisIsOwner = await db.OrgMemberships
            .AnyAsync(m => m.OrgId == orgId && m.UserId == userId && m.Role == OrgRole.Owner.ToWire(), ct);
        if (!thisIsOwner) return; // Demoting a non-owner is always fine.

        var otherOwners = await db.OrgMemberships
            .CountAsync(m => m.OrgId == orgId && m.UserId != userId && m.Role == OrgRole.Owner.ToWire(), ct);
        if (otherOwners == 0) {
            throw new ConflictException(
                "last_owner",
                "This is the org's only Owner. Promote another member to Owner first, or transfer ownership.");
        }
    }
}

/// <summary>Maps to 409 in the endpoint error mapper.</summary>
public sealed class ConflictException : Exception {
    public string Code { get; }
    public ConflictException(string code, string message) : base(message) {
        Code = code;
    }
}
