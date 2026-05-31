using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Integrations;
using TimeFlow.Integrations.Contract;
using TimeFlow.Rbac;
using TimeFlow.Vault;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/integrations/* — manage upstream tracker connections.
//
// Connections are owned by a (project, user, provider) tuple — each
// member brings their own credentials to the engagements they're
// allocated on. The mirrored upstream sub-projects + tasks hang under
// the engagement project so the owner can always trace which member's
// connection produced them.
//
// Credential lifecycle:
//   * POST /integrations: raw credential arrives in the request body,
//     adapter.VerifyAsync MUST succeed before we persist, then the
//     credential gets vault-encrypted with context=`integration:{id}`
//     and stored. The raw never touches the DB.
//   * GET /integrations: never returns the credential — only metadata
//     (provider, name, upstream user, last-verified-at).
//   * POST /test: re-runs Verify and refreshes last_verified_at + the
//     bucketed error code.
//   * Proxy reads (projects, tasks): decrypt → call adapter → return
//     the normalised DTO. Decryption happens in-request and the key
//     is zeroed by the vault.
//
// Permissions:
//   * IntegrationsRead (Viewer+) gates everything at the URL level — it
//     just asserts org membership. The actual "can this caller see / act
//     on THIS connection" check is the ownership gate inside each handler
//     (`LoadOwnedOrManagerAsync`): Manager+ on the org sees everything;
//     everyone else only sees connections they own. List scopes the same
//     way and additionally surfaces project-mates' connections so the
//     project's Integrations tab can show the full picture.
//   * IntegrationsCreate (Developer+) gates POST so any project member
//     can add THEIR OWN integration without needing admin sign-off — but
//     the handler enforces project-membership as well.
//   * IntegrationsConfigure (Admin+) stays available for future
//     org-level governance endpoints (e.g. "reassign owner").
public static class IntegrationEndpoints {
    public static void MapIntegrationEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/integrations").RequireAuthorization();

        grp.MapGet("", List).RequireOrgPermission(Permission.IntegrationsRead);
        grp.MapPost("", Create).RequireOrgPermission(Permission.IntegrationsCreate);
        grp.MapPost("/{connId:guid}/test", Test).RequireOrgPermission(Permission.IntegrationsRead);
        grp.MapDelete("/{connId:guid}", Delete).RequireOrgPermission(Permission.IntegrationsRead);

        grp.MapGet("/{connId:guid}/projects", ProxyProjects).RequireOrgPermission(Permission.IntegrationsRead);
        grp.MapGet("/{connId:guid}/projects/{projectId}/tasks", ProxyTasks).RequireOrgPermission(Permission.IntegrationsRead);
        grp.MapPost("/{connId:guid}/worklog", ProxyWorklog).RequireOrgPermission(Permission.WorklogsWriteOwn);

        // Synced cache (populated by the WorklogSyncJob into native_tasks).
        // The proxy reads above hit upstream LIVE; these read from the local
        // cache so the calendar / pickers / future AI surfaces have a fast
        // no-network task list to work with.
        grp.MapGet("/{connId:guid}/synced", ListSynced).RequireOrgPermission(Permission.IntegrationsRead);
        grp.MapGet("/{connId:guid}/synced/projects", ListSyncedProjects).RequireOrgPermission(Permission.IntegrationsRead);
        grp.MapGet("/{connId:guid}/synced/versions", ListSyncedVersions).RequireOrgPermission(Permission.IntegrationsRead);
    }

    public sealed record ConnectionItem(
        Guid Id, string Provider, string Name,
        string? UpstreamUserId, string? UpstreamUserName,
        DateTime? LastVerifiedAt, string? LastVerifyError,
        DateTime CreatedAt,
        // (project, user) ownership tuple — one connection per
        // (project, user, provider). Names included so the SPA can
        // render the linkage without a second round trip.
        Guid ProjectId, string? ProjectName,
        Guid UserId, string? UserName);

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/integrations
    // ---------------------------------------------------------------------
    // Default scope:
    //   * Manager+ sees every connection in the org.
    //   * Everyone else sees their own connections AND the connections of
    //     project-mates on projects where the caller is also a member —
    //     so the project's Integrations tab can list peers' setups.
    public static async Task<IResult> List(
        Guid id,
        Guid? projectId,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        var canSeeAll = role.AtLeast(OrgRole.Manager);
        // Cache key encodes both the scope and the project filter so the
        // /projects/:id Integrations tab and the org-wide settings list
        // can't poison each other's slices.
        var scopeKey = canSeeAll ? "scope:all" : $"scope:user:{callerId:N}";
        var projectKey = projectId is Guid pf ? $":project:{pf:N}" : "";
        var items = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:integrations:list:{scopeKey}{projectKey}",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:integrations" },
            loader: async ct2 => {
                var q = db.IntegrationConnections.Where(c => c.OrgId == orgId);
                if (projectId is Guid pid) q = q.Where(c => c.ProjectId == pid);
                if (!canSeeAll && callerId is Guid uid) {
                    // Member sees own + project-mate connections.
                    var visibleProjectIds = db.ProjectMembers
                        .Where(pm => pm.OrgId == orgId && pm.UserId == uid)
                        .Select(pm => pm.ProjectId);
                    q = q.Where(c => c.UserId == uid || visibleProjectIds.Contains(c.ProjectId));
                }
                return await (
                    from c in q
                    join p in db.NativeProjects.AsNoTracking() on c.ProjectId equals p.Id into pj
                    from p in pj.DefaultIfEmpty()
                    join u in db.Users.AsNoTracking() on c.UserId equals u.Id into uj
                    from u in uj.DefaultIfEmpty()
                    orderby c.Provider, c.Name
                    select new ConnectionItem(
                        c.Id, c.Provider, c.Name,
                        c.UpstreamUserId, c.UpstreamUserName,
                        c.LastVerifiedAt, c.LastVerifyError,
                        c.CreatedAt,
                        c.ProjectId, p != null ? p.Name : null,
                        c.UserId, u != null ? (string.IsNullOrEmpty(u.Name) ? u.Email : u.Name) : null)
                ).ToListAsync(ct2);
            },
            ct: ct);
        return Results.Ok(items);
    }

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/integrations
    // ---------------------------------------------------------------------
    // Raw credentials per provider — same shape as the adapter's record.
    // The owning userId is taken from the caller; there's no body field
    // for it (a member can only add their own integration).
    public sealed record CreateConnectionRequest(
        [Required] string Provider,
        [Required, MinLength(2), MaxLength(120)] string Name,
        // The engagement project this connection belongs to. The caller
        // must already be a project_members row on this project.
        [Required] Guid ProjectId,
        // OPTIONAL — the existing native project to use as the integration
        // wrapper (anchor for the upstream sub-projects). Must be a child
        // of `ProjectId`. When null, the create handler auto-creates a
        // wrapper named after `Name` under the engagement.
        Guid? WrapperProjectId,
        // Only one of these will be populated based on Provider; we keep
        // them flat (rather than a polymorphic union) so the SPA doesn't
        // have to switch on a discriminator before serialising.
        string? BaseUrl,
        string? Token,
        string? Email);

    public static async Task<IResult> Create(
        Guid id,
        CreateConnectionRequest body,
        TimeFlowDbContext db,
        IIntegrationRegistry registry,
        IVaultService vault,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        if (!IntegrationProviders.IsKnown(body.Provider)) {
            return Results.Json(new { error = "Unknown integration provider." }, statusCode: 400);
        }

        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        if (callerId is not Guid uid) {
            return Results.Json(new { error = "Authenticated user id missing." }, statusCode: 401);
        }

        // Pre-flight: the target project exists in this org and the caller
        // is a project_members row on it. "Project member" = the gate;
        // no allocation means no integration.
        var projectOk = await db.NativeProjects
            .AnyAsync(p => p.Id == body.ProjectId && p.OrgId == orgId, ct);
        if (!projectOk) return Results.Json(new { error = "Project not found in this org." }, statusCode: 400);
        var isProjectMember = await db.ProjectMembers
            .AnyAsync(pm => pm.ProjectId == body.ProjectId && pm.UserId == uid, ct);
        if (!isProjectMember) {
            return Results.Json(new {
                error = "You must be a project member to add an integration to this project.",
                code = "not_project_member",
            }, statusCode: 403);
        }

        // (project, user, provider) UNIQUE pre-check — one connection per
        // tuple. The DB index below catches a race; the explicit check
        // gives a friendly 409 in the happy path.
        var connectionTaken = await db.IntegrationConnections.AnyAsync(
            c => c.ProjectId == body.ProjectId
                && c.UserId == uid
                && c.Provider == body.Provider, ct);
        if (connectionTaken) {
            return Results.Conflict(new {
                error = "You already have a connection for this provider on this project.",
                code = "connection_taken",
            });
        }

        // Pre-allocate the row id so it can serve as the vault binding
        // context BEFORE the row is persisted.
        var connectionId = Guid.NewGuid();

        IntegrationCredentials creds;
        try {
            creds = BuildCredentials(body);
        } catch (ArgumentException ex) {
            return Results.Json(new { error = ex.Message }, statusCode: 400);
        }

        var adapter = registry.Get(body.Provider);
        IntegrationVerifyResult verify;
        try {
            verify = await adapter.VerifyAsync(creds, ct);
        } catch (UpstreamIntegrationException ex) {
            return Results.Json(new { error = ex.Message, code = ex.Class.ToString().ToLower() }, statusCode: 400);
        }
        if (!verify.Ok) {
            return Results.Json(new { error = "Upstream rejected the credential." }, statusCode: 400);
        }

        var encrypted = vault.Encrypt(registry.EncodeCredentials(creds), VaultContext(connectionId));
        var row = new IntegrationConnection {
            Id = connectionId,
            OrgId = orgId,
            Provider = body.Provider,
            Name = body.Name.Trim(),
            ProjectId = body.ProjectId,
            UserId = uid,
            EncryptedCredentials = encrypted,
            UpstreamUserId = verify.UserId,
            UpstreamUserName = verify.UserName,
            LastVerifiedAt = DateTime.UtcNow,
            LastVerifyError = null,
            CreatedBy = callerId,
        };
        db.IntegrationConnections.Add(row);

        // Anchor the upstream tree under a wrapper project so the synced
        // sub-projects land at  engagement → wrapper → upstream  instead
        // of flat under the engagement. Caller can pass an existing child
        // project as the wrapper or let us auto-create one named after
        // the connection.
        Guid wrapperId;
        if (body.WrapperProjectId is Guid existing) {
            var ok = await db.NativeProjects
                .AnyAsync(p => p.Id == existing
                    && p.OrgId == orgId
                    && p.ParentProjectId == body.ProjectId, ct);
            if (!ok) {
                return Results.Json(new {
                    error = "wrapperProjectId must be a child of projectId.",
                    code = "invalid_wrapper",
                }, statusCode: 400);
            }
            // Tag the chosen wrapper with the connection_id so the sync
            // job can find it via (connection_id, upstream_project_id=NULL).
            var wrapperRow = await db.NativeProjects.FirstAsync(p => p.Id == existing, ct);
            wrapperRow.ConnectionId = connectionId;
            wrapperId = existing;
        } else {
            var wrapper = new NativeProject {
                OrgId = orgId,
                Name = body.Name.Trim(),
                ParentProjectId = body.ProjectId,
                ConnectionId = connectionId,
                Type = "integration",
                CreatedBy = callerId,
            };
            db.NativeProjects.Add(wrapper);
            wrapperId = wrapper.Id;
        }

        try {
            await db.SaveChangesAsync(ct);
        } catch (DbUpdateException ex) when (IsUniqueViolation(ex)) {
            return Results.Conflict(new {
                error = "Connection already exists.",
                code = "connection_taken",
            });
        }

        await cache.InvalidateTagsAsync(new[] {
            $"org:{orgId:N}:integrations",
            $"org:{orgId:N}:projects",
        }, ct);
        await audit.RecordAsync("integration.created", orgId, callerId, "integration", row.Id.ToString(),
            new { provider = row.Provider, name = row.Name, upstreamUserId = row.UpstreamUserId,
                  projectId = row.ProjectId, userId = row.UserId }, ct);

        var projectName = await db.NativeProjects.AsNoTracking()
            .Where(p => p.Id == row.ProjectId).Select(p => p.Name).FirstOrDefaultAsync(ct);
        var userName = await db.Users.AsNoTracking()
            .Where(u => u.Id == row.UserId).Select(u => string.IsNullOrEmpty(u.Name) ? u.Email : u.Name).FirstOrDefaultAsync(ct);
        return Results.Ok(new ConnectionItem(
            row.Id, row.Provider, row.Name,
            row.UpstreamUserId, row.UpstreamUserName,
            row.LastVerifiedAt, row.LastVerifyError, row.CreatedAt,
            row.ProjectId, projectName,
            row.UserId, userName));
    }

    // ---------------------------------------------------------------------
    // POST /api/orgs/{id}/integrations/{connId}/test — re-run verify
    // ---------------------------------------------------------------------
    public static async Task<IResult> Test(
        Guid id, Guid connId,
        TimeFlowDbContext db,
        IIntegrationRegistry registry,
        IVaultService vault,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var conn = await LoadOwnedOrManagerAsync(connId, http, db, ct);
        if (conn is null) return Results.NotFound();

        var creds = DecryptCredentials(conn, vault, registry);
        var adapter = registry.Get(conn.Provider);

        try {
            var verify = await adapter.VerifyAsync(creds, ct);
            conn.LastVerifiedAt = DateTime.UtcNow;
            conn.LastVerifyError = null;
            conn.UpstreamUserId = verify.UserId;
            conn.UpstreamUserName = verify.UserName;
            conn.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:integrations" }, ct);
            return Results.Ok(new { ok = true, lastVerifiedAt = conn.LastVerifiedAt });
        } catch (UpstreamIntegrationException ex) {
            conn.LastVerifyError = ex.Class.ToString().ToLower();
            conn.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:integrations" }, ct);
            await audit.RecordAsync("integration.test_failed", orgId, callerId, "integration", conn.Id.ToString(),
                new { errorClass = ex.Class.ToString() }, ct);
            return Results.Json(new { ok = false, error = ex.Message, code = ex.Class.ToString().ToLower() }, statusCode: 400);
        }
    }

    // ---------------------------------------------------------------------
    // DELETE /api/orgs/{id}/integrations/{connId}
    // ---------------------------------------------------------------------
    // Refused unless the caller is the connection's owner OR manager+ on
    // the org. The cookie auth gate (IntegrationsRead viewer+) was widened
    // here because non-owners need to see the delete button is missing.
    public static async Task<IResult> Delete(
        Guid id, Guid connId,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var conn = await db.IntegrationConnections
            .FirstOrDefaultAsync(c => c.Id == connId && c.OrgId == orgId, ct);
        if (conn is null) return Results.NotFound();

        var isOwner = callerId is Guid uid && conn.UserId == uid;
        var isManager = role.AtLeast(OrgRole.Manager);
        if (!isOwner && !isManager) {
            return Results.Json(new {
                error = "Only the connection's owner or a manager can delete it.",
                code = "not_owner",
            }, statusCode: 403);
        }

        db.IntegrationConnections.Remove(conn);
        await db.SaveChangesAsync(ct);
        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:integrations" }, ct);
        await audit.RecordAsync("integration.deleted", orgId, callerId, "integration", conn.Id.ToString(),
            new { provider = conn.Provider, name = conn.Name }, ct);
        return Results.Ok(new { ok = true });
    }

    // ---------------------------------------------------------------------
    // Proxy reads
    // ---------------------------------------------------------------------
    public static async Task<IResult> ProxyProjects(
        Guid id, Guid connId, int? maxItems,
        TimeFlowDbContext db,
        IIntegrationRegistry registry,
        IVaultService vault,
        HttpContext http,
        CancellationToken ct) {
        var conn = await LoadOwnedOrManagerAsync(connId, http, db, ct);
        if (conn is null) return Results.NotFound();
        var creds = DecryptCredentials(conn, vault, registry);
        var adapter = registry.Get(conn.Provider);

        try {
            var list = new List<IntegrationProject>();
            await foreach (var p in adapter.ListProjectsAsync(creds, maxItems ?? 100, ct)) list.Add(p);
            return Results.Ok(list);
        } catch (UpstreamIntegrationException ex) {
            return Results.Json(new { error = ex.Message, code = ex.Class.ToString().ToLower() }, statusCode: 502);
        }
    }

    public static async Task<IResult> ProxyTasks(
        Guid id, Guid connId, string projectId, int? maxItems,
        TimeFlowDbContext db,
        IIntegrationRegistry registry,
        IVaultService vault,
        HttpContext http,
        CancellationToken ct) {
        var conn = await LoadOwnedOrManagerAsync(connId, http, db, ct);
        if (conn is null) return Results.NotFound();
        var creds = DecryptCredentials(conn, vault, registry);
        var adapter = registry.Get(conn.Provider);

        try {
            var list = new List<IntegrationTask>();
            await foreach (var t in adapter.ListTasksAsync(creds, projectId, maxItems ?? 200, ct: ct)) list.Add(t);
            return Results.Ok(list);
        } catch (UpstreamIntegrationException ex) {
            return Results.Json(new { error = ex.Message, code = ex.Class.ToString().ToLower() }, statusCode: 502);
        }
    }

    public sealed record WorklogPushRequest(
        [Required] string TaskId,
        [Required, Range(0.0, 24.0)] decimal Hours,
        [Required] DateOnly Date,
        string? Comment);

    public static async Task<IResult> ProxyWorklog(
        Guid id, Guid connId,
        WorklogPushRequest body,
        TimeFlowDbContext db,
        IIntegrationRegistry registry,
        IVaultService vault,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var conn = await LoadOwnedOrManagerAsync(connId, http, db, ct);
        if (conn is null) return Results.NotFound();
        var creds = DecryptCredentials(conn, vault, registry);
        var adapter = registry.Get(conn.Provider);

        try {
            var result = await adapter.PostWorklogAsync(creds, body.TaskId, body.Hours, body.Date, body.Comment, ct);
            await audit.RecordAsync("integration.worklog_pushed", orgId, callerId, "integration", conn.Id.ToString(),
                new { taskId = body.TaskId, hours = body.Hours, date = body.Date, upstreamId = result.UpstreamId }, ct);
            return Results.Ok(result);
        } catch (UpstreamIntegrationException ex) {
            return Results.Json(new { error = ex.Message, code = ex.Class.ToString().ToLower() }, statusCode: 502);
        }
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    // Synced cache reads — fast, no upstream calls
    // ---------------------------------------------------------------------
    public sealed record SyncedTaskItem(
        Guid Id,
        string UpstreamId,
        string UpstreamProjectId,
        string Title,
        string Status,
        string? AssigneeUpstreamId,
        DateTime? UpstreamUpdatedAt,
        DateTime LastSyncedAt,
        string? UpstreamVersionId,
        string? UpstreamVersionName);

    public sealed record SyncedProjectGroup(
        string UpstreamProjectId,
        int TaskCount);

    public sealed record SyncedVersionItem(
        string UpstreamVersionId,
        string UpstreamVersionName,
        int TaskCount);

    public static async Task<IResult> ListSynced(
        Guid id, Guid connId,
        string? projectId, string? search, string? status, string? versionId, int? skip, int? take,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();

        // Ownership-or-manager gate. 404 (not 403) when a non-owner non-manager
        // asks; keeps connection ids opaque to enumerators.
        var conn = await LoadOwnedOrManagerAsync(connId, http, db, ct);
        if (conn is null) return Results.NotFound();

        // Phase C — read mirrored tasks from native_tasks, joined to
        // their parent native_projects row to recover the upstream
        // project id the SyncedTaskItem DTO promises.
        var q = from t in db.NativeTasks.AsNoTracking()
                join p in db.NativeProjects.AsNoTracking() on t.ProjectId equals p.Id
                where t.OrgId == orgId
                    && t.ConnectionId == connId
                    && t.UpstreamTaskId != null
                    && p.UpstreamProjectId != null
                select new { t, p };
        if (!string.IsNullOrWhiteSpace(projectId)) {
            q = q.Where(x => x.p.UpstreamProjectId == projectId);
        }
        if (!string.IsNullOrWhiteSpace(search)) {
            var s = search.Trim().ToLower();
            q = q.Where(x => x.t.Title.ToLower().Contains(s) || x.t.UpstreamTaskId!.Contains(s));
        }
        if (!string.IsNullOrWhiteSpace(status)) {
            q = q.Where(x => x.t.Status == status);
        }
        if (!string.IsNullOrWhiteSpace(versionId)) {
            if (versionId == "none") q = q.Where(x => x.t.UpstreamVersionId == null);
            else q = q.Where(x => x.t.UpstreamVersionId == versionId);
        }

        var total = await q.CountAsync(ct);
        var page = await q
            .OrderByDescending(x => x.t.UpstreamUpdatedAt ?? x.t.UpdatedAt)
            .Skip(Math.Max(0, skip ?? 0))
            .Take(Math.Clamp(take ?? 100, 1, 500))
            .Select(x => new SyncedTaskItem(
                x.t.Id,
                x.t.UpstreamTaskId!,
                x.p.UpstreamProjectId!,
                x.t.Title,
                x.t.Status,
                x.t.AssigneeUpstreamId,
                x.t.UpstreamUpdatedAt,
                x.t.UpdatedAt,
                x.t.UpstreamVersionId,
                x.t.UpstreamVersionName))
            .ToListAsync(ct);

        return Results.Ok(new { total, items = page });
    }

    public static async Task<IResult> ListSyncedVersions(
        Guid id, Guid connId,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var conn = await LoadOwnedOrManagerAsync(connId, http, db, ct);
        if (conn is null) return Results.NotFound();

        // Distinct sprints/versions seen across this connection's tasks —
        // populates the filter dropdown. Empty version stripped (the UI
        // shows it as the special "(no sprint)" option separately if it
        // wants to surface unscoped tasks).
        var rows = await db.NativeTasks.AsNoTracking()
            .Where(t => t.ConnectionId == connId && t.OrgId == orgId
                && t.UpstreamTaskId != null
                && t.UpstreamVersionId != null && t.UpstreamVersionName != null)
            .GroupBy(t => new { t.UpstreamVersionId, t.UpstreamVersionName })
            .Select(g => new { g.Key.UpstreamVersionId, g.Key.UpstreamVersionName, Count = g.Count() })
            .OrderByDescending(g => g.Count)
            .ToListAsync(ct);

        return Results.Ok(rows.Select(r => new SyncedVersionItem(
            r.UpstreamVersionId!, r.UpstreamVersionName!, r.Count)));
    }

    public static async Task<IResult> ListSyncedProjects(
        Guid id, Guid connId,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();

        var conn = await LoadOwnedOrManagerAsync(connId, http, db, ct);
        if (conn is null) return Results.NotFound();

        // Project to an anonymous type first — EF Core 8 can't translate
        // a GroupBy().Select(g => new RecordType(...)) when the record
        // takes positional constructor args. The anonymous shape
        // translates to `SELECT col, COUNT(*) … GROUP BY col` cleanly.
        // Group mirrored tasks by their parent native_project's upstream id.
        var rows = await (
            from t in db.NativeTasks.AsNoTracking()
            join p in db.NativeProjects.AsNoTracking() on t.ProjectId equals p.Id
            where t.ConnectionId == connId && t.OrgId == orgId
                && t.UpstreamTaskId != null && p.UpstreamProjectId != null
            group t by p.UpstreamProjectId into g
            select new { ProjectId = g.Key!, Count = g.Count() })
            .OrderByDescending(g => g.Count)
            .ToListAsync(ct);

        return Results.Ok(rows.Select(r => new SyncedProjectGroup(r.ProjectId, r.Count)));
    }

    // ---------------------------------------------------------------------
    /// <summary>
    /// Load a connection if the caller is allowed to act on it. Manager+
    /// on the org sees every connection (governance); everyone else only
    /// the ones they own. Returns null when the connection doesn't exist
    /// OR the caller can't see it — the caller turns it into a 404,
    /// matching the "don't leak existence" pattern documented in CLAUDE.md
    /// (NotFoundError over ForbiddenError).
    /// </summary>
    internal static async Task<IntegrationConnection?> LoadOwnedOrManagerAsync(
        Guid connId, HttpContext http, TimeFlowDbContext db, CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        var conn = await db.IntegrationConnections
            .FirstOrDefaultAsync(c => c.Id == connId && c.OrgId == orgId, ct);
        if (conn is null) return null;
        if (role.AtLeast(OrgRole.Manager)) return conn;
        var callerId = AuthClaims.GetUserId(http.User);
        return callerId is Guid uid && conn.UserId == uid ? conn : null;
    }

    private static IntegrationCredentials DecryptCredentials(
        IntegrationConnection conn, IVaultService vault, IIntegrationRegistry registry) {
        var json = vault.Decrypt(conn.EncryptedCredentials, VaultContext(conn.Id));
        return registry.DecodeCredentials(conn.Provider, json);
    }

    private static IntegrationCredentials BuildCredentials(CreateConnectionRequest body) {
        switch (body.Provider) {
            case IntegrationProviders.OpenProject:
                Require(body.BaseUrl, "baseUrl");
                Require(body.Token, "token");
                return new OpenProjectCredentials(body.BaseUrl!, body.Token!);
            case IntegrationProviders.Jira:
                Require(body.BaseUrl, "baseUrl");
                Require(body.Email, "email");
                Require(body.Token, "token");
                return new JiraCredentials(body.BaseUrl!, body.Email!, body.Token!);
            case IntegrationProviders.Linear:
                Require(body.Token, "token");
                return new LinearCredentials(body.Token!);
            case IntegrationProviders.GitLab:
                Require(body.BaseUrl, "baseUrl");
                Require(body.Token, "token");
                return new GitLabCredentials(body.BaseUrl!, body.Token!);
            default:
                throw new ArgumentException($"Unknown provider '{body.Provider}'.");
        }
    }

    private static void Require(string? value, string field) {
        if (string.IsNullOrWhiteSpace(value)) {
            throw new ArgumentException($"Missing required field: {field}.");
        }
    }

    private static string VaultContext(Guid connectionId) => $"integration:{connectionId:N}";

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505";
}
