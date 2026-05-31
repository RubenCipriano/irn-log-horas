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

// /api/orgs/{id}/projects — native PM project CRUD.
//
// Projects are now the engagement unit AND the invoiced party — Client
// was collapsed into this model, so the billing-party fields (contact
// email/name, tax id, address, default rate) live directly here.
//
// Read = viewer+ (everyone in the org can see project list).
// Write = tech_lead+ (matches the legacy ProjectsWrite gate).
// Delete = tech_lead+ too — Phase 6 keeps it simple; future iterations
// could add a "wrote anything against this project" check before
// allowing destructive removes.
public static class ProjectEndpoints {
    public static void MapProjectEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/projects").RequireAuthorization();

        grp.MapGet("", List).RequireOrgPermission(Permission.ProjectsRead);
        grp.MapPost("", Create).RequireOrgPermission(Permission.ProjectsWrite);
        grp.MapGet("/{projectId:guid}", GetOne).RequireOrgPermission(Permission.ProjectsRead);
        grp.MapGet("/{projectId:guid}/children", ListChildren).RequireOrgPermission(Permission.ProjectsRead);
        grp.MapPatch("/{projectId:guid}", Update).RequireOrgPermission(Permission.ProjectsWrite);
        grp.MapDelete("/{projectId:guid}", Delete).RequireOrgPermission(Permission.ProjectsWrite);

        // Unified endpoint — merges native_projects + upstream_projects
        // (synced from integrations) into one list. Used by the topbar
        // ProjectSwitcher + /projects view + calendar day-form.
        var unified = app.MapGroup("/api/orgs/{id:guid}/projects-unified")
            .RequireAuthorization();
        unified.MapGet("", ListUnified).RequireOrgPermission(Permission.ProjectsRead);
    }

    public sealed record ProjectItem(
        Guid Id, string Name, string? Code, bool Archived, DateTime CreatedAt, DateTime UpdatedAt,
        decimal? BillRate,
        string? ContactEmail, string? ContactName, string? TaxId, string? Address,
        decimal? DefaultBillRate);

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/projects
    // ---------------------------------------------------------------------
    public static async Task<IResult> List(
        Guid id,
        // Nullable so omitting the query param defaults to false instead
        // of 400. Minimal APIs require a value for non-nullable bool params.
        bool? includeArchived,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        // We don't cache the includeArchived=true variant (small audience —
        // just the project-admin screen) so the tag invalidation on
        // archive/unarchive doesn't have to track a second key shape.
        if (includeArchived == true) {
            var all = await db.NativeProjects
                .Where(p => p.OrgId == orgId)
                .OrderBy(p => p.Archived).ThenBy(p => p.Name)
                .Select(p => new ProjectItem(
                    p.Id, p.Name, p.Code, p.Archived, p.CreatedAt, p.UpdatedAt, p.BillRate,
                    p.ContactEmail, p.ContactName, p.TaxId, p.Address, p.DefaultBillRate))
                .ToListAsync(ct);
            return Results.Ok(all);
        }
        var active = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:projects:active",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:projects" },
            loader: async ct2 => await db.NativeProjects
                .Where(p => p.OrgId == orgId && !p.Archived)
                .OrderBy(p => p.Name)
                .Select(p => new ProjectItem(
                    p.Id, p.Name, p.Code, p.Archived, p.CreatedAt, p.UpdatedAt, p.BillRate,
                    p.ContactEmail, p.ContactName, p.TaxId, p.Address, p.DefaultBillRate))
                .ToListAsync(ct2),
            ct: ct);
        return Results.Ok(active);
    }

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/projects
    // ---------------------------------------------------------------------
    public sealed record CreateProjectRequest(
        [Required, MinLength(2), MaxLength(160)] string Name,
        [MaxLength(40)] string? Code,
        decimal? BillRate,
        [EmailAddress, MaxLength(200)] string? ContactEmail,
        [MaxLength(200)] string? ContactName,
        [MaxLength(60)] string? TaxId,
        string? Address,
        decimal? DefaultBillRate);

    public static async Task<IResult> Create(
        Guid id,
        CreateProjectRequest body,
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

        if (body.BillRate is decimal br && (br < 0m || br > 999_999.99m)) {
            return Results.Json(new { error = "BillRate must be between 0 and 999999.99." }, statusCode: 400);
        }
        if (body.DefaultBillRate is decimal dbr && (dbr < 0m || dbr > 999_999.99m)) {
            return Results.Json(new { error = "DefaultBillRate must be between 0 and 999999.99." }, statusCode: 400);
        }

        var project = new NativeProject {
            OrgId = orgId,
            Name = body.Name.Trim(),
            Code = string.IsNullOrWhiteSpace(body.Code) ? null : body.Code.Trim(),
            BillRate = body.BillRate,
            ContactEmail = string.IsNullOrWhiteSpace(body.ContactEmail) ? null : body.ContactEmail.Trim(),
            ContactName = string.IsNullOrWhiteSpace(body.ContactName) ? null : body.ContactName.Trim(),
            TaxId = string.IsNullOrWhiteSpace(body.TaxId) ? null : body.TaxId.Trim(),
            Address = string.IsNullOrWhiteSpace(body.Address) ? null : body.Address,
            DefaultBillRate = body.DefaultBillRate,
            CreatedBy = callerId,
        };
        db.NativeProjects.Add(project);
        try {
            await db.SaveChangesAsync(ct);
        } catch (DbUpdateException ex) when (IsUniqueViolation(ex)) {
            return Results.Conflict(new { error = "Code already in use for this org." });
        }

        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:projects" }, ct);
        await audit.RecordAsync("project.created", orgId, callerId, "project", project.Id.ToString(),
            new { name = project.Name, code = project.Code }, ct);

        return Results.Ok(new ProjectItem(
            project.Id, project.Name, project.Code, project.Archived,
            project.CreatedAt, project.UpdatedAt, project.BillRate,
            project.ContactEmail, project.ContactName, project.TaxId, project.Address, project.DefaultBillRate));
    }

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/projects/{projectId}
    // ---------------------------------------------------------------------
    public static async Task<IResult> GetOne(
        Guid id, Guid projectId,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var project = await db.NativeProjects
            .Where(p => p.OrgId == orgId && p.Id == projectId)
            .Select(p => new ProjectItem(
                p.Id, p.Name, p.Code, p.Archived, p.CreatedAt, p.UpdatedAt, p.BillRate,
                p.ContactEmail, p.ContactName, p.TaxId, p.Address, p.DefaultBillRate))
            .FirstOrDefaultAsync(ct);
        return project is null ? Results.NotFound() : Results.Ok(project);
    }

    public sealed record ProjectChildItem(
        Guid Id, string Name, string? Code, string Type, bool Archived,
        // Mirror-tuple metadata so the SPA can render the right icon /
        // breadcrumbs. Both null for hand-rolled native sub-projects.
        Guid? ConnectionId, string? UpstreamProjectId,
        // Counts for the row badge — task count on THIS child, plus the
        // count of grand-children so a wrapper project shows "13 projetos"
        // rather than "0 tarefas" when the leaves carry the tasks.
        int TaskCount, int ChildProjectCount);

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/projects/{projectId}/children
    // Returns DIRECT children of `projectId`. The SPA's "Projetos" tab on
    // the project detail page uses this to render the sub-project list.
    // ---------------------------------------------------------------------
    public static async Task<IResult> ListChildren(
        Guid id, Guid projectId,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var parentExists = await db.NativeProjects
            .AnyAsync(p => p.Id == projectId && p.OrgId == orgId, ct);
        if (!parentExists) return Results.NotFound();

        var rows = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:projects:{projectId:N}:children",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:projects", $"org:{orgId:N}:tasks" },
            loader: async ct2 => await (
                from p in db.NativeProjects.AsNoTracking()
                where p.OrgId == orgId && p.ParentProjectId == projectId
                orderby p.Name
                select new ProjectChildItem(
                    p.Id, p.Name, p.Code, p.Type, p.Archived,
                    p.ConnectionId, p.UpstreamProjectId,
                    db.NativeTasks.Count(t => t.ProjectId == p.Id),
                    db.NativeProjects.Count(c => c.ParentProjectId == p.Id))
            ).ToListAsync(ct2),
            ct: ct);
        return Results.Ok(rows);
    }

    // ---------------------------------------------------------------------
    // PATCH /api/orgs/{id}/projects/{projectId}
    // ---------------------------------------------------------------------
    public sealed record UpdateProjectRequest(
        [MinLength(2), MaxLength(160)] string? Name,
        [MaxLength(40)] string? Code,
        bool? Archived,
        decimal? BillRate,
        bool? ClearBillRate,
        [EmailAddress, MaxLength(200)] string? ContactEmail,
        [MaxLength(200)] string? ContactName,
        [MaxLength(60)] string? TaxId,
        string? Address,
        decimal? DefaultBillRate,
        bool? ClearDefaultBillRate);

    public static async Task<IResult> Update(
        Guid id, Guid projectId,
        UpdateProjectRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var project = await db.NativeProjects
            .FirstOrDefaultAsync(p => p.OrgId == orgId && p.Id == projectId, ct);
        if (project is null) return Results.NotFound();

        if (!string.IsNullOrWhiteSpace(body.Name)) project.Name = body.Name.Trim();
        if (body.Code is not null) project.Code = string.IsNullOrWhiteSpace(body.Code) ? null : body.Code.Trim();
        if (body.Archived is not null) project.Archived = body.Archived.Value;

        if (body.ClearBillRate == true) project.BillRate = null;
        else if (body.BillRate is decimal br) {
            if (br < 0m || br > 999_999.99m) {
                return Results.Json(new { error = "BillRate must be between 0 and 999999.99." }, statusCode: 400);
            }
            project.BillRate = br;
        }

        if (body.ContactEmail is not null) project.ContactEmail = string.IsNullOrWhiteSpace(body.ContactEmail) ? null : body.ContactEmail.Trim();
        if (body.ContactName is not null) project.ContactName = string.IsNullOrWhiteSpace(body.ContactName) ? null : body.ContactName.Trim();
        if (body.TaxId is not null) project.TaxId = string.IsNullOrWhiteSpace(body.TaxId) ? null : body.TaxId.Trim();
        if (body.Address is not null) project.Address = string.IsNullOrWhiteSpace(body.Address) ? null : body.Address;

        if (body.ClearDefaultBillRate == true) project.DefaultBillRate = null;
        else if (body.DefaultBillRate is decimal dbr) {
            if (dbr < 0m || dbr > 999_999.99m) {
                return Results.Json(new { error = "DefaultBillRate must be between 0 and 999999.99." }, statusCode: 400);
            }
            project.DefaultBillRate = dbr;
        }

        project.UpdatedAt = DateTime.UtcNow;

        try {
            await db.SaveChangesAsync(ct);
        } catch (DbUpdateException ex) when (IsUniqueViolation(ex)) {
            return Results.Conflict(new { error = "Code already in use for this org." });
        }

        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:projects" }, ct);
        await audit.RecordAsync("project.updated", orgId, callerId, "project", project.Id.ToString(),
            new { name = project.Name, code = project.Code, archived = project.Archived }, ct);

        return Results.Ok(new ProjectItem(
            project.Id, project.Name, project.Code, project.Archived,
            project.CreatedAt, project.UpdatedAt, project.BillRate,
            project.ContactEmail, project.ContactName, project.TaxId, project.Address, project.DefaultBillRate));
    }

    // ---------------------------------------------------------------------
    // DELETE /api/orgs/{id}/projects/{projectId} — hard delete
    // ---------------------------------------------------------------------
    public static async Task<IResult> Delete(
        Guid id, Guid projectId,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var project = await db.NativeProjects.FirstOrDefaultAsync(p => p.OrgId == orgId && p.Id == projectId, ct);
        if (project is null) return Results.NotFound();

        // worklogs.project_id FK is now SetNull — deleting the project
        // detaches existing worklogs (they survive as "no project" rows,
        // already a valid state for upstream-task-backed worklogs).
        // Refuse only when an invoice line still references one of those
        // worklogs, since dropping the invoice's source attribution would
        // break the accounting record.
        var blockingInvoiceLines = await db.InvoiceLines
            .AnyAsync(l => l.WorklogId != null
                && db.Worklogs.Any(w => w.Id == l.WorklogId && w.ProjectId == projectId), ct);
        if (blockingInvoiceLines) {
            return Results.Conflict(new {
                error = "Project has worklogs already on an invoice. Void the invoice first.",
                code = "has_invoiced_worklogs",
            });
        }

        var detachCount = await db.Worklogs.CountAsync(w => w.ProjectId == projectId, ct);

        db.NativeProjects.Remove(project); // cascades tasks + project_members
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:projects", $"org:{orgId:N}:worklogs" }, ct);
        await audit.RecordAsync("project.deleted", orgId, callerId, "project", project.Id.ToString(),
            new { name = project.Name, detachedWorklogs = detachCount }, ct);

        return Results.Ok(new { ok = true, detachedWorklogs = detachCount });
    }

    // Postgres 23505 = unique_violation. EF wraps Npgsql's exception so
    // we peel back one layer.
    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505";

    // ---------------------------------------------------------------------
    // Unified view — native + upstream as a single list
    // ---------------------------------------------------------------------
    public sealed record UnifiedProjectItem(
        // Synthetic stable id: "native:{guid}" or "upstream:{connId}:{upstreamId}"
        // so the frontend can key a single list without colliding GUIDs.
        string Id,
        string Kind,                     // "native" | "upstream"
        string Name,
        string? Code,
        bool Archived,
        Guid? NativeProjectId,           // populated when kind=native
        Guid? ConnectionId,              // populated when kind=upstream
        string? UpstreamProjectId,       // populated when kind=upstream
        string? Provider,                // "openproject" | ... (kind=upstream only)
        string? ConnectionName);

    public static async Task<IResult> ListUnified(
        Guid id,
        bool? includeArchived,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var showArchived = includeArchived == true;

        // The flat /projects list shows ROOT projects only (engagements).
        // Upstream-mirrored sub-projects synced in by a connection live
        // UNDER the engagement project (parent_project_id = engagement)
        // and are visible via the project detail page, NOT alongside their
        // parent. The discriminator is the mirror tuple's presence — a
        // user-created engagement can ALSO end up upstream-typed if it
        // mirrors something, but in v1 the engagement is always native.
        var rows = await (
            from p in db.NativeProjects.AsNoTracking()
            join c in db.IntegrationConnections.AsNoTracking() on p.ConnectionId equals c.Id into cj
            from c in cj.DefaultIfEmpty()
            where p.OrgId == orgId
                && p.ParentProjectId == null
                && (showArchived || !p.Archived)
            orderby p.ConnectionId == null ? 0 : 1, p.Name
            select new {
                p.Id, p.Name, p.Code, p.Archived,
                p.ConnectionId, p.UpstreamProjectId,
                ConnectionName = c != null ? c.Name : null,
                Provider = c != null ? c.Provider : null,
            }
        ).ToListAsync(ct);

        var items = rows.Select(r => {
            var isUpstream = r.ConnectionId is Guid && r.UpstreamProjectId != null;
            return new UnifiedProjectItem(
                isUpstream
                    ? "upstream:" + r.ConnectionId!.Value.ToString("N") + ":" + r.UpstreamProjectId
                    : "native:" + r.Id.ToString("N"),
                isUpstream ? "upstream" : "native",
                r.Name,
                r.Code,
                r.Archived,
                isUpstream ? null : r.Id,
                isUpstream ? r.ConnectionId : null,
                isUpstream ? r.UpstreamProjectId : null,
                isUpstream ? r.Provider : null,
                isUpstream ? r.ConnectionName : null);
        }).ToList();

        return Results.Ok(items);
    }
}
