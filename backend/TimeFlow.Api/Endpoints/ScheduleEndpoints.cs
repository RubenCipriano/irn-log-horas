using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Domain.Holidays;
using TimeFlow.Domain.Schedule;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/policy/{expected-hours,holidays} — domain-derived
// reads against the org's policy JSON. Computed server-side so the
// frontend doesn't have to ship Easter math or schedule resolution.
//
// Both endpoints fall back to the built-in PT-IRN defaults when the
// org has no custom policy (null columns on `organisations`).
//
// Optional `projectId` query param routes through ProjectPolicyResolver —
// when set, the calendar denominator + holiday badges reflect the
// project's effective policy (project override → ancestor → org → default).
public static class ScheduleEndpoints {
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    public static void MapScheduleEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/policy").RequireAuthorization();
        grp.MapGet("/expected-hours", ExpectedHours).RequireOrgPermission(Permission.OrgRead);
        grp.MapGet("/holidays", Holidays).RequireOrgPermission(Permission.OrgRead);
    }

    public sealed record ExpectedHoursItem(DateOnly Date, decimal Hours);

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/policy/expected-hours?from=YYYY-MM-DD&to=YYYY-MM-DD&projectId=GUID
    // ---------------------------------------------------------------------
    public static async Task<IResult> ExpectedHours(
        Guid id, DateOnly? from, DateOnly? to, Guid? projectId,
        TimeFlowDbContext db, ICacheStore cache,
        ProjectPolicyResolver resolver,
        HttpContext http, CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var fromDate = from ?? new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        var toDate = to ?? fromDate.AddMonths(1).AddDays(-1);
        if (toDate < fromDate) return Results.Json(new { error = "to < from." }, statusCode: 400);
        if ((toDate.DayNumber - fromDate.DayNumber) > 366) {
            return Results.Json(new { error = "Range too wide (max 1 year)." }, statusCode: 400);
        }

        OrgScheduleConfig config;
        OrgHolidayProfile holidays;
        if (projectId is Guid pid) {
            // Defensive ownership check before resolving — don't leak
            // existence of foreign projects via "schedule lookup worked".
            var owned = await db.NativeProjects.AsNoTracking()
                .AnyAsync(p => p.Id == pid && p.OrgId == orgId, ct);
            if (!owned) return Results.NotFound();

            (config, holidays) = await ResolveForProjectAsync(orgId, pid, db, cache, resolver, ct);
        } else {
            config = await ResolveScheduleAsync(orgId, db, cache, ct);
            holidays = await ResolveHolidaysAsync(orgId, db, cache, ct);
        }

        var totals = new List<ExpectedHoursItem>((toDate.DayNumber - fromDate.DayNumber) + 1);
        for (var d = fromDate; d <= toDate; d = d.AddDays(1)) {
            totals.Add(new ExpectedHoursItem(d, ScheduleResolver.ResolveExpectedHours(d, config, holidays)));
        }
        return Results.Ok(new {
            from = fromDate, to = toDate,
            total = totals.Sum(t => t.Hours),
            days = totals,
        });
    }

    public sealed record HolidayItem(DateOnly Date, string Name, string Region);

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/policy/holidays?year=YYYY&projectId=GUID
    // ---------------------------------------------------------------------
    public static async Task<IResult> Holidays(
        Guid id, int? year, Guid? projectId,
        TimeFlowDbContext db, ICacheStore cache,
        ProjectPolicyResolver resolver,
        HttpContext http, CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var y = year ?? DateTime.UtcNow.Year;
        if (y < 1900 || y > 2200) return Results.Json(new { error = "year out of range." }, statusCode: 400);

        OrgHolidayProfile profile;
        if (projectId is Guid pid) {
            var owned = await db.NativeProjects.AsNoTracking()
                .AnyAsync(p => p.Id == pid && p.OrgId == orgId, ct);
            if (!owned) return Results.NotFound();

            (_, profile) = await ResolveForProjectAsync(orgId, pid, db, cache, resolver, ct);
        } else {
            profile = await ResolveHolidaysAsync(orgId, db, cache, ct);
        }

        var resolved = HolidayResolver.ResolveForYear(profile, y)
            .Select(h => new HolidayItem(h.Date, h.Name, h.Region));
        return Results.Ok(new { year = y, holidays = resolved });
    }

    // ---------------------------------------------------------------------
    // Internal: org-level resolvers. Cached for 2 min, invalidated by
    // the existing `org:{id}:policy` tag.
    // ---------------------------------------------------------------------
    private static async Task<OrgScheduleConfig> ResolveScheduleAsync(
        Guid orgId, TimeFlowDbContext db, ICacheStore cache, CancellationToken ct) {
        var json = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:policy:schedule",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:policy" },
            loader: async ct2 => await db.Organisations
                .Where(o => o.Id == orgId)
                .Select(o => o.ScheduleConfigJson)
                .FirstOrDefaultAsync(ct2),
            ct: ct);
        if (string.IsNullOrWhiteSpace(json)) return SchedulePresets.Default;
        try {
            return JsonSerializer.Deserialize<OrgScheduleConfig>(json, JsonOpts) ?? SchedulePresets.Default;
        } catch {
            // Bad payload (shouldn't happen — PATCH validates) — fall back
            // to default rather than 500. Audit table will already have a
            // record of the bad change.
            return SchedulePresets.Default;
        }
    }

    private static async Task<OrgHolidayProfile> ResolveHolidaysAsync(
        Guid orgId, TimeFlowDbContext db, ICacheStore cache, CancellationToken ct) {
        var json = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:policy:holidays",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:policy" },
            loader: async ct2 => await db.Organisations
                .Where(o => o.Id == orgId)
                .Select(o => o.HolidayProfileJson)
                .FirstOrDefaultAsync(ct2),
            ct: ct);
        if (string.IsNullOrWhiteSpace(json)) {
            return new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey };
        }
        try {
            return JsonSerializer.Deserialize<OrgHolidayProfile>(json, JsonOpts)
                ?? new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey };
        } catch {
            return new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey };
        }
    }

    // ---------------------------------------------------------------------
    // Internal: project-scoped resolver. Cache key carries the project id
    // and is tagged with BOTH the project's policy tag AND the org policy
    // tag (because the effective result depends on org fallback — when
    // org policy mutates, project-scoped reads must invalidate too).
    // ---------------------------------------------------------------------
    private static async Task<(OrgScheduleConfig schedule, OrgHolidayProfile holidays)> ResolveForProjectAsync(
        Guid orgId, Guid projectId,
        TimeFlowDbContext db, ICacheStore cache,
        ProjectPolicyResolver resolver,
        CancellationToken ct) {
        var key = $"org:{orgId:N}:project:{projectId:N}:policy:effective";
        var tags = ProjectPolicyCacheTags.ForProject(orgId, projectId);

        var packed = await cache.GetOrSetAsync(
            key: key,
            ttl: TimeSpan.FromMinutes(2),
            tags: tags,
            loader: async ct2 => {
                var resolved = await resolver.ResolveAsync(orgId, projectId, ct2);
                // Persist the raw JSON + country shortcut in the cache;
                // materialisation is cheap and we don't want to cache
                // OrgScheduleConfig instances (records with init-only
                // collections) through Redis.
                return new ProjectEffectivePolicyCache(
                    resolved.ScheduleConfigJson,
                    resolved.HolidayProfileJson,
                    resolved.HolidayCountry);
            },
            ct: ct);

        if (packed is null) {
            return (SchedulePresets.Default, new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey });
        }

        var schedule = TryParseSchedule(packed.ScheduleConfigJson) ?? SchedulePresets.Default;
        var holidays = TryParseHolidays(packed.HolidayProfileJson);
        if (holidays is null && !string.IsNullOrWhiteSpace(packed.HolidayCountry)) {
            var presetKey = HolidayCountries.PresetKeyForIso(packed.HolidayCountry);
            if (presetKey is not null) holidays = new OrgHolidayProfile { Preset = presetKey };
        }
        holidays ??= new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey };
        return (schedule, holidays);
    }

    // Cache DTO — three nullable strings, serialiser-friendly.
    private sealed record ProjectEffectivePolicyCache(
        string? ScheduleConfigJson,
        string? HolidayProfileJson,
        string? HolidayCountry);

    private static OrgScheduleConfig? TryParseSchedule(string? json) {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<OrgScheduleConfig>(json, JsonOpts); }
        catch { return null; }
    }

    private static OrgHolidayProfile? TryParseHolidays(string? json) {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<OrgHolidayProfile>(json, JsonOpts); }
        catch { return null; }
    }
}
