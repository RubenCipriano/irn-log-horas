using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/projects/{projectId}/policy — per-project schedule +
// holiday overrides. Mirrors the org-level PolicyEndpoints shape so a
// project (and any descendant) can run its own schedule / holiday
// calendar, falling back through the ancestor chain to the org policy.
//
// Storage shape: three nullable columns on native_projects
// (schedule_config text, holiday_profile text, holiday_country
// varchar(2)). NULL is the legitimate "inherit" sentinel.
//
// Read = OrgRead (any member who can see the project can see its
//   resolved calendar).
// Write = OrgUpdate (matches the org policy gate — schedule/holiday
//   changes affect billing windows + approval thresholds).
public static class ProjectPolicyEndpoints {
    private const int MaxJsonBytes = 32 * 1024;

    public static void MapProjectPolicyEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/projects/{projectId:guid}/policy")
            .RequireAuthorization();

        grp.MapGet("", Get).RequireOrgPermission(Permission.OrgRead);
        grp.MapPatch("", Update).RequireOrgPermission(Permission.OrgUpdate);

        // Country lookup: small whitelist of holiday-country presets the UI
        // can render in a dropdown. Hung off the org policy group for URI
        // uniformity with the rest of the policy surface.
        var countries = app.MapGroup("/api/orgs/{id:guid}/policy/holiday-countries")
            .RequireAuthorization();
        countries.MapGet("", ListCountries).RequireOrgPermission(Permission.OrgRead);
    }

    public sealed record EffectivePolicyBlock(
        string? ScheduleConfig, string ScheduleSource, string? ScheduleSourceName,
        string? HolidayProfile, string HolidaySource, string? HolidaySourceName,
        string? HolidayCountry, string HolidayCountrySource, string? HolidayCountrySourceName);

    public sealed record ProjectPolicyResponse(
        Guid ProjectId, string ProjectName,
        string? ScheduleConfig, string? HolidayProfile, string? HolidayCountry,
        DateTime UpdatedAt,
        EffectivePolicyBlock Effective);

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/projects/{projectId}/policy
    // ---------------------------------------------------------------------
    public static async Task<IResult> Get(
        Guid id, Guid projectId,
        TimeFlowDbContext db,
        ICacheStore cache,
        ProjectPolicyResolver resolver,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();

        // Verify project belongs to the org BEFORE caching anything —
        // a cross-org id should 404, not poison a key in the wrong org's
        // namespace.
        var owned = await db.NativeProjects.AsNoTracking()
            .AnyAsync(p => p.Id == projectId && p.OrgId == orgId, ct);
        if (!owned) return Results.NotFound();

        var policy = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:project:{projectId:N}:policy",
            ttl: TimeSpan.FromMinutes(2),
            tags: ProjectPolicyCacheTags.ForProject(orgId, projectId),
            loader: ct2 => BuildResponseAsync(db, resolver, orgId, projectId, ct2),
            ct: ct);

        return policy is null ? Results.NotFound() : Results.Ok(policy);
    }

    // ---------------------------------------------------------------------
    // PATCH /api/orgs/{id}/projects/{projectId}/policy
    // ---------------------------------------------------------------------
    // Tri-state mirror of PolicyEndpoints: Set* tells us "the caller wants
    // to touch this field"; the value (possibly null) is what to write.
    // Omitting Set* leaves the field unchanged.
    public sealed record UpdateProjectPolicyRequest(
        bool SetSchedule,
        string? ScheduleConfig,
        bool SetHolidays,
        string? HolidayProfile,
        bool SetHolidayCountry,
        string? HolidayCountry);

    public static async Task<IResult> Update(
        Guid id, Guid projectId,
        UpdateProjectPolicyRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        ProjectPolicyResolver resolver,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        if (body.SetSchedule && !ValidateJsonPayload(body.ScheduleConfig, out var sErr)) {
            return Results.Json(new { error = $"scheduleConfig: {sErr}" }, statusCode: 400);
        }
        if (body.SetHolidays && !ValidateJsonPayload(body.HolidayProfile, out var hErr)) {
            return Results.Json(new { error = $"holidayProfile: {hErr}" }, statusCode: 400);
        }
        if (body.SetHolidayCountry && body.HolidayCountry is not null) {
            if (body.HolidayCountry.Length != 2
                || !HolidayCountries.IsKnownIso(body.HolidayCountry)) {
                return Results.Json(
                    new { error = "holidayCountry: must be a supported ISO-3166-1 alpha-2 code." },
                    statusCode: 400);
            }
        }

        var project = await db.NativeProjects.FirstOrDefaultAsync(
            p => p.Id == projectId && p.OrgId == orgId, ct);
        if (project is null) return Results.NotFound();

        var diff = new {
            schedule = body.SetSchedule
                ? new { from = project.ScheduleConfig, to = body.ScheduleConfig }
                : null,
            holidays = body.SetHolidays
                ? new { from = project.HolidayProfile, to = body.HolidayProfile }
                : null,
            holidayCountry = body.SetHolidayCountry
                ? new { from = project.HolidayCountry, to = body.HolidayCountry?.ToUpperInvariant() }
                : null,
        };

        if (body.SetSchedule) project.ScheduleConfig = body.ScheduleConfig;
        if (body.SetHolidays) project.HolidayProfile = body.HolidayProfile;
        if (body.SetHolidayCountry) project.HolidayCountry = body.HolidayCountry?.ToUpperInvariant();
        project.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        // Invalidate the project's own cache. The org:{orgId}:projects tag
        // is also dropped so any unified-tree consumer that surfaces a
        // "has-policy-override" badge refreshes too.
        await cache.InvalidateTagsAsync(new[] {
            ProjectPolicyCacheTags.OrgPolicyTag(orgId),
            ProjectPolicyCacheTags.ProjectPolicyTag(orgId, projectId),
            $"org:{orgId:N}:projects",
        }, ct);

        await audit.RecordAsync("project.policy_changed", orgId, callerId,
            "project", projectId.ToString(), diff, ct);

        var response = await BuildResponseAsync(db, resolver, orgId, projectId, ct);
        return response is null ? Results.NotFound() : Results.Ok(response);
    }

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/policy/holiday-countries
    // ---------------------------------------------------------------------
    public sealed record HolidayCountryItem(string Code, string PresetKey, string DisplayName);

    public static IResult ListCountries(Guid id, HttpContext http) {
        // RequireOrgContext isn't called — we only need the auth filter to
        // have run. The data is a static lookup.
        var items = HolidayCountries.All
            .Select(c => new HolidayCountryItem(c.Iso, c.PresetKey, c.DisplayName))
            .ToList();
        return Results.Ok(new { countries = items });
    }

    // ---------------------------------------------------------------------
    // Internal: assemble the GET/PATCH response.
    // ---------------------------------------------------------------------
    private static async Task<ProjectPolicyResponse?> BuildResponseAsync(
        TimeFlowDbContext db, ProjectPolicyResolver resolver,
        Guid orgId, Guid projectId, CancellationToken ct) {
        var raw = await db.NativeProjects.AsNoTracking()
            .Where(p => p.Id == projectId && p.OrgId == orgId)
            .Select(p => new {
                p.Id, p.Name,
                p.ScheduleConfig, p.HolidayProfile, p.HolidayCountry,
                p.UpdatedAt,
            })
            .FirstOrDefaultAsync(ct);
        if (raw is null) return null;

        var resolved = await resolver.ResolveAsync(orgId, projectId, ct);

        // Pull ancestor names for badge rendering. Only hit the DB if any
        // source is actually an ancestor (otherwise sources are project /
        // org / default, which need no name lookup).
        var ancestorIds = new HashSet<Guid>();
        if (resolved.ScheduleSourceProjectId is Guid s) ancestorIds.Add(s);
        if (resolved.HolidaySourceProjectId is Guid h) ancestorIds.Add(h);
        if (resolved.HolidayCountrySourceProjectId is Guid c) ancestorIds.Add(c);

        Dictionary<Guid, string> names = ancestorIds.Count == 0
            ? new Dictionary<Guid, string>()
            : await db.NativeProjects.AsNoTracking()
                .Where(p => p.OrgId == orgId && ancestorIds.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, p => p.Name, ct);

        string? NameFor(Guid? id) =>
            id is Guid g && names.TryGetValue(g, out var n) ? n : null;

        var effective = new EffectivePolicyBlock(
            ScheduleConfig: resolved.ScheduleConfigJson,
            ScheduleSource: resolved.ScheduleSource,
            ScheduleSourceName: NameFor(resolved.ScheduleSourceProjectId),
            HolidayProfile: resolved.HolidayProfileJson,
            HolidaySource: resolved.HolidaySource,
            HolidaySourceName: NameFor(resolved.HolidaySourceProjectId),
            HolidayCountry: resolved.HolidayCountry,
            HolidayCountrySource: resolved.HolidayCountrySource,
            HolidayCountrySourceName: NameFor(resolved.HolidayCountrySourceProjectId));

        return new ProjectPolicyResponse(
            ProjectId: raw.Id,
            ProjectName: raw.Name,
            ScheduleConfig: raw.ScheduleConfig,
            HolidayProfile: raw.HolidayProfile,
            HolidayCountry: raw.HolidayCountry,
            UpdatedAt: raw.UpdatedAt,
            Effective: effective);
    }

    private static bool ValidateJsonPayload(string? payload, out string error) {
        error = "";
        if (payload is null) return true; // null = clear local override

        var bytes = System.Text.Encoding.UTF8.GetByteCount(payload);
        if (bytes > MaxJsonBytes) {
            error = $"too large ({bytes} bytes, max {MaxJsonBytes}).";
            return false;
        }
        try {
            using var _ = JsonDocument.Parse(payload);
            return true;
        } catch (JsonException ex) {
            error = $"invalid JSON: {ex.Message}";
            return false;
        }
    }
}

// Tag names for the project + org policy keys. Centralised so the
// resolver, the GET cache wrapper, and the org-policy PATCH all agree
// on the strings.
internal static class ProjectPolicyCacheTags {
    public static string OrgPolicyTag(Guid orgId) => $"org:{orgId:N}:policy";
    public static string ProjectPolicyTag(Guid orgId, Guid projectId) =>
        $"org:{orgId:N}:project:{projectId:N}:policy";

    public static string[] ForProject(Guid orgId, Guid projectId) => new[] {
        OrgPolicyTag(orgId),
        ProjectPolicyTag(orgId, projectId),
        // Tree shape changes (re-parent, archive) live under this tag;
        // when the tree mutates the ancestor walk's result can change, so
        // policy reads must refresh too.
        $"org:{orgId:N}:projects",
    };
}
