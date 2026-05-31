using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/projects/{projectId}/members — per-project allocations
// of users to projects. The allocation now carries the project-scoped
// role (viewer/developer/tech_lead/manager) and the deny flag, plus the
// per-(member, project) rate that drives both cost reports AND invoice
// generation (cost = bill in v1 per the consulting use case).
//
// Auth model:
//   * Read = ProjectsRead (viewer+); rate is HR-adjacent so it's stripped
//     server-side for non-managers (same shape as MemberEndpoints.List).
//   * Allocate / update / unallocate = ProjectsWrite (tech-lead+). Rate
//     edits ride the same gate now per the v1 decision; the older
//     MembersUpdateCost gate stayed at org-level but is dropped here.
//
// Spec invariants enforced here:
//   * I9 — last-manager guard: refuse a delete / deny / role demotion
//     that would leave the project with zero active managers. Phase B
//     left the tree flat so the count is direct; mark TODO for the
//     ancestor walk when real hierarchy lands.
public static class ProjectMemberEndpoints {
    public static void MapProjectMemberEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/projects/{projectId:guid}/members")
            .RequireAuthorization();
        grp.MapGet("", List).RequireOrgPermission(Permission.ProjectsRead);
        grp.MapPost("", Allocate).RequireOrgPermission(Permission.ProjectsWrite);
        grp.MapPatch("/{userId:guid}", Update).RequireOrgPermission(Permission.ProjectsWrite);
        grp.MapDelete("/{userId:guid}", Unallocate).RequireOrgPermission(Permission.ProjectsWrite);
    }

    public sealed record ProjectMemberItem(
        Guid UserId, string Email, string Name,
        string RoleOnProject, bool Denied,
        decimal? CostPerHour, DateTime AllocatedAt);

    private static readonly string[] AllowedRoles = ["viewer", "developer", "tech_lead", "manager"];

    private static string? NormaliseRole(string? raw) {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var r = raw.Trim().ToLowerInvariant();
        return Array.IndexOf(AllowedRoles, r) >= 0 ? r : null;
    }

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/projects/{projectId}/members
    // ---------------------------------------------------------------------
    public static async Task<IResult> List(
        Guid id, Guid projectId,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        var projectExists = await db.NativeProjects
            .AnyAsync(p => p.Id == projectId && p.OrgId == orgId, ct);
        if (!projectExists) return Results.NotFound();

        var canSeeCost = role.AtLeast(OrgRole.Manager);
        // Cost visibility changes the response shape — bucket the key so a
        // Manager's cached rows (with rates) aren't served to a Viewer.
        var costBucket = canSeeCost ? "full" : "redacted";
        var rows = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:projects:{projectId:N}:members:{costBucket}",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:members", $"org:{orgId:N}:projects" },
            loader: async ct2 => {
                // Order BEFORE projecting into the record — ordering by a
                // field on the constructed ProjectMemberItem can't be
                // translated to SQL by EF Core 8. Project to an anonymous
                // type the DB can handle, then map to the DTO in-memory.
                var raw = await (
                    from pm in db.ProjectMembers.AsNoTracking()
                    join u in db.Users.AsNoTracking() on pm.UserId equals u.Id
                    where pm.ProjectId == projectId && pm.OrgId == orgId
                    orderby u.Name
                    select new {
                        u.Id, u.Email, u.Name,
                        pm.RoleOnProject, pm.Denied,
                        pm.CostPerHour, pm.AllocatedAt,
                    }
                ).ToListAsync(ct2);
                return raw.Select(r => new ProjectMemberItem(
                    r.Id, r.Email, r.Name,
                    r.RoleOnProject, r.Denied,
                    canSeeCost ? r.CostPerHour : null,
                    r.AllocatedAt)).ToList();
            },
            ct: ct);
        return Results.Ok(rows);
    }

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/projects/{projectId}/members
    // Allocate a member. Idempotent — re-posting an existing pair updates
    // any fields that differ.
    // ---------------------------------------------------------------------
    public sealed record AllocateRequest(
        [Required] Guid UserId,
        string? RoleOnProject,
        decimal? CostPerHour,
        bool? Denied);

    public static async Task<IResult> Allocate(
        Guid id, Guid projectId,
        AllocateRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var project = await db.NativeProjects
            .FirstOrDefaultAsync(p => p.Id == projectId && p.OrgId == orgId, ct);
        if (project is null) return Results.NotFound();

        // Verify the target user is actually a member of this org — we
        // can't allocate outsiders to a project.
        var isMember = await db.OrgMemberships
            .AnyAsync(m => m.OrgId == orgId && m.UserId == body.UserId, ct);
        if (!isMember) return Results.Json(new { error = "User is not a member of this org." }, statusCode: 400);

        var role = body.RoleOnProject is null ? "developer" : NormaliseRole(body.RoleOnProject);
        if (role is null) return Results.Json(new { error = "Unknown role." }, statusCode: 400);

        if (body.CostPerHour is decimal cv && (cv < 0m || cv > 999_999.99m)) {
            return Results.Json(new { error = "Rate must be between 0 and 999999.99." }, statusCode: 400);
        }
        var denied = body.Denied ?? false;

        var existing = await db.ProjectMembers
            .FirstOrDefaultAsync(pm => pm.ProjectId == projectId && pm.UserId == body.UserId, ct);
        if (existing is null) {
            // Brand-new allocation. If creating as denied, we don't need
            // the last-manager guard (a denied row can't decrement the
            // manager count below where it was).
            db.ProjectMembers.Add(new ProjectMember {
                ProjectId = projectId,
                UserId = body.UserId,
                OrgId = orgId,
                RoleOnProject = role,
                Denied = denied,
                CostPerHour = body.CostPerHour,
                AllocatedBy = callerId,
            });
            await db.SaveChangesAsync(ct);
            await audit.RecordAsync("project_member.allocated", orgId, callerId, "project_member",
                $"{projectId}:{body.UserId}",
                new { projectId, userId = body.UserId, role, denied, costPerHour = body.CostPerHour }, ct);
        } else {
            // Idempotent allocate with new fields — treat as an update.
            // Apply the same last-manager check the PATCH path uses so
            // the two surfaces stay consistent.
            var conflict = await ManagerCountAfterChangeAsync(
                db, projectId, body.UserId, existing,
                newRole: role, newDenied: denied, removing: false, ct);
            if (conflict) {
                return Results.Json(new {
                    error = "Cannot leave the project without a manager.",
                    code = "last_manager",
                }, statusCode: 409);
            }
            existing.RoleOnProject = role;
            existing.Denied = denied;
            if (body.CostPerHour is not null) existing.CostPerHour = body.CostPerHour;
            await db.SaveChangesAsync(ct);
            await audit.RecordAsync("project_member.updated", orgId, callerId, "project_member",
                $"{projectId}:{body.UserId}",
                new { projectId, userId = body.UserId, role, denied, costPerHour = body.CostPerHour }, ct);
        }

        // Member rate changes invalidate the worklogs cache too — the
        // invoice gather + hours-summary derive rate per-(user, project)
        // now, so stale worklog rows would still show the old rate.
        await cache.InvalidateTagsAsync(new[] {
            $"org:{orgId:N}:members",
            $"org:{orgId:N}:projects",
            $"org:{orgId:N}:worklogs",
        }, ct);

        return Results.Ok(new { ok = true });
    }

    // ---------------------------------------------------------------------
    // PATCH /api/orgs/{id}/projects/{projectId}/members/{userId}
    // Unified update — role, rate, deny. All fields optional; defined-only
    // fields write through. `ClearCost: true` nulls the rate (distinct
    // from "omit the field, leave unchanged").
    // ---------------------------------------------------------------------
    public sealed record UpdateRequest(
        string? RoleOnProject,
        decimal? CostPerHour,
        bool? ClearCost,
        bool? Denied);

    public static async Task<IResult> Update(
        Guid id, Guid projectId, Guid userId,
        UpdateRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        if (body.CostPerHour is decimal v && (v < 0m || v > 999_999.99m)) {
            return Results.Json(new { error = "Rate must be between 0 and 999999.99." }, statusCode: 400);
        }

        var row = await db.ProjectMembers
            .FirstOrDefaultAsync(pm => pm.ProjectId == projectId && pm.UserId == userId && pm.OrgId == orgId, ct);
        if (row is null) return Results.NotFound();

        string? newRole = row.RoleOnProject;
        if (body.RoleOnProject is not null) {
            newRole = NormaliseRole(body.RoleOnProject);
            if (newRole is null) return Results.Json(new { error = "Unknown role." }, statusCode: 400);
        }
        var newDenied = body.Denied ?? row.Denied;

        var conflict = await ManagerCountAfterChangeAsync(
            db, projectId, userId, row,
            newRole: newRole, newDenied: newDenied, removing: false, ct);
        if (conflict) {
            return Results.Json(new {
                error = "Cannot leave the project without a manager.",
                code = "last_manager",
            }, statusCode: 409);
        }

        var oldCost = row.CostPerHour;
        decimal? newCost = oldCost;
        if (body.ClearCost == true) newCost = null;
        else if (body.CostPerHour is not null) newCost = body.CostPerHour;

        var roleChanged = row.RoleOnProject != newRole;
        var deniedChanged = row.Denied != newDenied;
        var costChanged = oldCost != newCost;

        if (!roleChanged && !deniedChanged && !costChanged) {
            return Results.Ok(new {
                ok = true,
                roleOnProject = row.RoleOnProject,
                denied = row.Denied,
                costPerHour = row.CostPerHour,
            });
        }

        row.RoleOnProject = newRole!;
        row.Denied = newDenied;
        row.CostPerHour = newCost;
        await db.SaveChangesAsync(ct);

        await audit.RecordAsync("project_member.updated", orgId, callerId, "project_member",
            $"{projectId}:{userId}",
            new {
                role = newRole, denied = newDenied,
                from = oldCost, to = newCost,
            }, ct);
        await cache.InvalidateTagsAsync(new[] {
            $"org:{orgId:N}:members",
            $"org:{orgId:N}:projects",
            $"org:{orgId:N}:worklogs",
        }, ct);

        return Results.Ok(new {
            ok = true,
            roleOnProject = row.RoleOnProject,
            denied = row.Denied,
            costPerHour = row.CostPerHour,
        });
    }

    // ---------------------------------------------------------------------
    // DELETE /api/orgs/{id}/projects/{projectId}/members/{userId}
    // ---------------------------------------------------------------------
    public static async Task<IResult> Unallocate(
        Guid id, Guid projectId, Guid userId,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var row = await db.ProjectMembers
            .FirstOrDefaultAsync(pm => pm.ProjectId == projectId && pm.UserId == userId && pm.OrgId == orgId, ct);
        if (row is null) return Results.NotFound();

        // Refuse the unallocation while this (project, user) still owns
        // any integration connection — the connection's FK to project_members
        // would orphan. Member must drop their integration first.
        var hasConnection = await db.IntegrationConnections
            .AnyAsync(c => c.ProjectId == projectId && c.UserId == userId, ct);
        if (hasConnection) {
            return Results.Json(new {
                error = "Member still owns an integration on this project. Remove the integration first.",
                code = "has_connection",
            }, statusCode: 409);
        }

        var conflict = await ManagerCountAfterChangeAsync(
            db, projectId, userId, row,
            newRole: row.RoleOnProject, newDenied: row.Denied, removing: true, ct);
        if (conflict) {
            return Results.Json(new {
                error = "Cannot leave the project without a manager.",
                code = "last_manager",
            }, statusCode: 409);
        }

        db.ProjectMembers.Remove(row);
        await db.SaveChangesAsync(ct);
        await cache.InvalidateTagsAsync(new[] {
            $"org:{orgId:N}:members",
            $"org:{orgId:N}:projects",
            $"org:{orgId:N}:worklogs",
        }, ct);
        await audit.RecordAsync("project_member.unallocated", orgId, callerId, "project_member",
            $"{projectId}:{userId}",
            new { projectId, userId }, ct);

        return Results.Ok(new { ok = true });
    }

    /// <summary>
    /// I9 last-manager guard. Returns true when the proposed change would
    /// leave the project with zero active managers (role='manager' AND
    /// NOT denied). The Phase B backfill left the tree flat so this is a
    /// direct count; once the sync starts producing real hierarchy the
    /// effective-manager count needs to walk ancestors per spec I1/I2.
    /// TODO (spec I1/I2): replace with recursive-CTE walk when hierarchy
    /// gets created beyond Phase B's flat roots.
    /// </summary>
    private static async Task<bool> ManagerCountAfterChangeAsync(
        TimeFlowDbContext db, Guid projectId, Guid userId,
        ProjectMember currentRow,
        string newRole, bool newDenied, bool removing,
        CancellationToken ct) {
        var wasActiveManager = currentRow.RoleOnProject == "manager" && !currentRow.Denied;
        var willBeActiveManager = !removing && newRole == "manager" && !newDenied;
        if (wasActiveManager == willBeActiveManager) return false; // delta is 0
        if (willBeActiveManager) return false;                     // delta is +1, never blocks

        // delta is -1 — count peers excluding this row.
        var peers = await db.ProjectMembers
            .Where(m => m.ProjectId == projectId
                     && m.UserId != userId
                     && m.RoleOnProject == "manager"
                     && !m.Denied)
            .CountAsync(ct);
        return peers == 0;
    }
}
