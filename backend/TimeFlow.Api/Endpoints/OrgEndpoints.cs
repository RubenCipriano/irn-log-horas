using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/* — tenant CRUD + ownership transfer.
//
// Authz contract: every org-scoped sub-route gates on RequireOrgPermission
// from Phase 4. The list/create routes are user-scoped and only need a
// signed-in user. DELETE adds a re-authentication step (password) on top
// of the role check — same trade-off as the legacy stack.
public static class OrgEndpoints {
    public static void MapOrgEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs").RequireAuthorization();

        // User-scoped (no orgId yet).
        grp.MapGet("", ListMine);
        grp.MapPost("", Create);

        // Org-scoped — RequireOrgPermission resolves orgId from {id}.
        grp.MapGet("/{id:guid}", GetOne).RequireOrgPermission(Permission.OrgRead);
        grp.MapPatch("/{id:guid}", Update).RequireOrgPermission(Permission.OrgUpdate);
        grp.MapDelete("/{id:guid}", Delete).RequireOrgPermission(Permission.OrgDelete);
        grp.MapPost("/{id:guid}/transfer", Transfer).RequireOrgPermission(Permission.OrgTransferOwnership);
    }

    // ---------------------------------------------------------------------
    // GET /api/orgs — orgs the caller is a member of
    // ---------------------------------------------------------------------
    public static async Task<IResult> ListMine(
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        var orgs = await db.OrgMemberships
            .Where(m => m.UserId == userId.Value)
            .OrderBy(m => m.CreatedAt)
            .Select(m => new OrgListItem(m.Org!.Id, m.Org.Name, m.Role, m.Org.CreatedAt))
            .ToListAsync(ct);

        return Results.Ok(orgs);
    }

    public sealed record OrgListItem(Guid Id, string Name, string Role, DateTime CreatedAt);

    // ---------------------------------------------------------------------
    // POST /api/orgs — create + auto-add caller as Owner
    // ---------------------------------------------------------------------
    public sealed record CreateOrgRequest(
        [Required, MinLength(2), MaxLength(120)] string Name);

    public static async Task<IResult> Create(
        CreateOrgRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        var org = new Organisation {
            Name = body.Name.Trim(),
            OwnerId = userId.Value,
        };
        var membership = new OrgMembership {
            OrgId = org.Id,
            UserId = userId.Value,
            Role = OrgRole.Owner.ToWire(),
        };
        db.Organisations.Add(org);
        db.OrgMemberships.Add(membership);
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] {
            MembershipCacheTags.UserOrgs(userId.Value),
            MembershipCacheTags.OrgMembers(org.Id),
        }, ct);
        await audit.RecordAsync("org.created", org.Id, userId, "org", org.Id.ToString(),
            new { name = org.Name }, ct);

        return Results.Ok(new OrgListItem(org.Id, org.Name, membership.Role, org.CreatedAt));
    }

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}
    // ---------------------------------------------------------------------
    public static async Task<IResult> GetOne(
        Guid id,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == orgId, ct);
        if (org is null) return Results.NotFound();

        return Results.Ok(new OrgDetail(
            org.Id, org.Name, org.OwnerId, role.ToWire(), org.CreatedAt, org.UpdatedAt));
    }

    public sealed record OrgDetail(
        Guid Id, string Name, Guid? OwnerId, string YourRole,
        DateTime CreatedAt, DateTime UpdatedAt);

    // ---------------------------------------------------------------------
    // PATCH /api/orgs/{id} — rename (Admin+)
    // ---------------------------------------------------------------------
    public sealed record UpdateOrgRequest(
        [Required, MinLength(2), MaxLength(120)] string Name);

    public static async Task<IResult> Update(
        Guid id,
        UpdateOrgRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var (orgId, _) = http.RequireOrgContext();
        var userId = AuthClaims.GetUserId(http.User);
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == orgId, ct);
        if (org is null) return Results.NotFound();

        var before = org.Name;
        org.Name = body.Name.Trim();
        org.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] { MembershipCacheTags.OrgMeta(orgId) }, ct);
        await audit.RecordAsync("org.updated", orgId, userId, "org", orgId.ToString(),
            new { from = new { name = before }, to = new { name = org.Name } }, ct);

        return Results.Ok(new OrgDetail(
            org.Id, org.Name, org.OwnerId, http.RequireOrgContext().Role.ToWire(), org.CreatedAt, org.UpdatedAt));
    }

    // ---------------------------------------------------------------------
    // DELETE /api/orgs/{id} — Owner + name match + password challenge
    // ---------------------------------------------------------------------
    public sealed record DeleteOrgRequest(
        [Required] string ConfirmName,
        [Required, MinLength(1)] string Password);

    public static async Task<IResult> Delete(
        Guid id,
        // DELETE bodies aren't auto-inferred (HTTP convention says DELETE
        // shouldn't carry one) — annotate explicitly so the request reads
        // the JSON challenge payload.
        [FromBody] DeleteOrgRequest body,
        TimeFlowDbContext db,
        IPasswordHasher hasher,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var (orgId, _) = http.RequireOrgContext();
        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == orgId, ct);
        if (user?.PasswordHash is null || org is null) return Results.NotFound();

        if (!string.Equals(body.ConfirmName, org.Name, StringComparison.Ordinal)) {
            await audit.RecordAsync("org.delete_blocked.name_mismatch", orgId, userId, "org", orgId.ToString(),
                new { typed = body.ConfirmName }, ct);
            return Results.Json(new { error = "Org name does not match." }, statusCode: 400);
        }
        if (!hasher.Verify(body.Password, user.PasswordHash)) {
            await audit.RecordAsync("org.delete_blocked.bad_password", orgId, userId, "org", orgId.ToString(), null, ct);
            return Results.Json(new { error = "Password is incorrect." }, statusCode: 401);
        }

        // Snapshot the member ids BEFORE delete so we can invalidate their
        // per-user caches afterwards.
        var memberIds = await db.OrgMemberships
            .Where(m => m.OrgId == orgId)
            .Select(m => m.UserId)
            .ToListAsync(ct);

        db.Organisations.Remove(org); // cascades memberships + squads
        await db.SaveChangesAsync(ct);

        var tags = new List<string> {
            MembershipCacheTags.OrgMembers(orgId),
            MembershipCacheTags.OrgMeta(orgId),
            MembershipCacheTags.OrgPolicy(orgId),
            MembershipCacheTags.OrgSquads(orgId),
        };
        tags.AddRange(memberIds.Select(MembershipCacheTags.UserOrgs));
        await cache.InvalidateTagsAsync(tags, ct);
        await audit.RecordAsync("org.deleted", null, userId, "org", orgId.ToString(),
            new { name = org.Name }, ct);

        return Results.Ok(new { ok = true });
    }

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/transfer — Owner handoff (password challenge)
    // ---------------------------------------------------------------------
    public sealed record TransferRequest(
        [Required] Guid NewOwnerId,
        [Required, MinLength(1)] string Password);

    public static async Task<IResult> Transfer(
        Guid id,
        TransferRequest body,
        TimeFlowDbContext db,
        IPasswordHasher hasher,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var (orgId, _) = http.RequireOrgContext();
        var userId = AuthClaims.GetUserId(http.User);
        if (userId is null) return Results.Unauthorized();

        if (body.NewOwnerId == userId.Value) {
            return Results.Json(new { error = "Cannot transfer to yourself." }, statusCode: 400);
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value, ct);
        if (user?.PasswordHash is null) return Results.Unauthorized();
        if (!hasher.Verify(body.Password, user.PasswordHash)) {
            await audit.RecordAsync("org.transfer_blocked.bad_password", orgId, userId, "org", orgId.ToString(), null, ct);
            return Results.Json(new { error = "Password is incorrect." }, statusCode: 401);
        }

        var current = await db.OrgMemberships.FirstOrDefaultAsync(
            m => m.OrgId == orgId && m.UserId == userId.Value, ct);
        var target = await db.OrgMemberships.FirstOrDefaultAsync(
            m => m.OrgId == orgId && m.UserId == body.NewOwnerId, ct);
        if (current is null) return Results.NotFound();
        if (target is null) {
            return Results.Json(new { error = "Target user is not a member of this org." }, statusCode: 400);
        }

        // Atomic swap — promote target, demote current to Admin.
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        target.Role = OrgRole.Owner.ToWire();
        current.Role = OrgRole.Admin.ToWire();
        var org = await db.Organisations.FirstAsync(o => o.Id == orgId, ct);
        org.OwnerId = body.NewOwnerId;
        org.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        await cache.InvalidateTagsAsync(new[] {
            MembershipCacheTags.OrgMembers(orgId),
            MembershipCacheTags.OrgMeta(orgId),
            MembershipCacheTags.UserOrgs(userId.Value),
            MembershipCacheTags.UserOrgs(body.NewOwnerId),
        }, ct);
        await audit.RecordAsync("org.ownership_transferred", orgId, userId, "org", orgId.ToString(),
            new { from = userId, to = body.NewOwnerId }, ct);

        return Results.Ok(new { ok = true, newOwnerId = body.NewOwnerId });
    }
}
