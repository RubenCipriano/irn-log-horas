using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Domain.Holidays;
using TimeFlow.Domain.Schedule;

namespace TimeFlow.Api.Services;

// Per-project policy cascade resolver.
//
// Hierarchy (highest priority first):
//   1. The project's own schedule_config / holiday_profile / holiday_country
//   2. The nearest ancestor with the field set (parent_project_id walk)
//   3. The org's policy (organisations.schedule_config / holiday_profile)
//   4. Baked PT-IRN defaults (SchedulePresets.Default + HolidayPresets.Portugal)
//
// Each of the three fields walks INDEPENDENTLY — a project that sets
// schedule_config but not holiday_profile / holiday_country inherits the
// holiday side from the next ancestor that has either of those set, etc.
//
// Cycle / pathological-depth guard: ancestor walk is capped at depth 32.
// On hit, we log and fall through to org/defaults. I7 cycle-prevention
// in the re-parent path is owed separately.
//
// JSON-vs-country precedence (same row): a row that sets holiday_profile
// JSON wins over the same row's holiday_country shortcut. Across the
// chain, depth wins regardless of which column carried the value.
public sealed class ProjectPolicyResolver {
    private const int MaxAncestorDepth = 32;
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly TimeFlowDbContext _db;
    private readonly ICacheStore _cache;
    private readonly ILogger<ProjectPolicyResolver> _log;

    public ProjectPolicyResolver(
        TimeFlowDbContext db, ICacheStore cache, ILogger<ProjectPolicyResolver> log) {
        _db = db;
        _cache = cache;
        _log = log;
    }

    // Source enum the API + UI use to render "Inherited from {ancestor}" badges.
    //   "project"          — set on the project itself
    //   "ancestor:{guid:N}" — inherited from a specific ancestor
    //   "org"              — fell back to org-level policy
    //   "default"          — fell back to baked PT-IRN defaults
    public sealed record ResolvedPolicy(
        string? ScheduleConfigJson,
        string ScheduleSource,
        Guid? ScheduleSourceProjectId,
        string? HolidayProfileJson,
        string HolidaySource,
        Guid? HolidaySourceProjectId,
        string? HolidayCountry,
        string HolidayCountrySource,
        Guid? HolidayCountrySourceProjectId);

    /// <summary>
    /// Resolve the effective policy for a project by walking ancestors,
    /// then falling back to org policy and baked defaults.
    /// </summary>
    public async Task<ResolvedPolicy> ResolveAsync(
        Guid orgId, Guid projectId, CancellationToken ct) {
        // The chain is the cheap O(depth) projection — id + parent + the
        // three policy columns. We pull the whole org's projects only when
        // we need name resolution for the UI; the resolver itself stays
        // tiny + cached.
        var chain = await LoadAncestorChainAsync(orgId, projectId, ct);
        if (chain.Count == 0) {
            // Project not in org — caller should already have 404'd before
            // reaching here, but keep the contract honest.
            return DefaultsOnly();
        }

        string? scheduleJson = null;
        var scheduleSource = "default";
        Guid? scheduleSourceProjectId = null;

        string? holidayJson = null;
        var holidaySource = "default";
        Guid? holidaySourceProjectId = null;

        string? holidayCountry = null;
        var holidayCountrySource = "default";
        Guid? holidayCountrySourceProjectId = null;

        var depth = 0;
        foreach (var node in chain) {
            if (++depth > MaxAncestorDepth) {
                _log.LogWarning(
                    "ProjectPolicyResolver depth cap hit at project {ProjectId} (org {OrgId}). Treating as cycle; falling back to org/default.",
                    projectId, orgId);
                break;
            }

            if (scheduleJson is null && node.ScheduleConfig is not null) {
                scheduleJson = node.ScheduleConfig;
                scheduleSource = node.Id == projectId ? "project" : $"ancestor:{node.Id:N}";
                scheduleSourceProjectId = node.Id == projectId ? null : node.Id;
            }
            if (holidayJson is null && node.HolidayProfile is not null) {
                holidayJson = node.HolidayProfile;
                holidaySource = node.Id == projectId ? "project" : $"ancestor:{node.Id:N}";
                holidaySourceProjectId = node.Id == projectId ? null : node.Id;
            }
            if (holidayCountry is null && node.HolidayCountry is not null) {
                holidayCountry = node.HolidayCountry;
                holidayCountrySource = node.Id == projectId ? "project" : $"ancestor:{node.Id:N}";
                holidayCountrySourceProjectId = node.Id == projectId ? null : node.Id;
            }
            if (scheduleJson is not null && holidayJson is not null && holidayCountry is not null) break;
        }

        // Org-level fallback for the JSON fields (holiday_country has no
        // org equivalent — we leave it null and let HolidayPresets apply
        // the default key downstream).
        if (scheduleJson is null || holidayJson is null) {
            var org = await _db.Organisations.AsNoTracking()
                .Where(o => o.Id == orgId)
                .Select(o => new { o.ScheduleConfigJson, o.HolidayProfileJson })
                .SingleOrDefaultAsync(ct);
            if (org is not null) {
                if (scheduleJson is null && org.ScheduleConfigJson is not null) {
                    scheduleJson = org.ScheduleConfigJson;
                    scheduleSource = "org";
                }
                if (holidayJson is null && org.HolidayProfileJson is not null) {
                    holidayJson = org.HolidayProfileJson;
                    holidaySource = "org";
                }
            }
        }

        return new ResolvedPolicy(
            scheduleJson, scheduleSource, scheduleSourceProjectId,
            holidayJson, holidaySource, holidaySourceProjectId,
            holidayCountry, holidayCountrySource, holidayCountrySourceProjectId);
    }

    /// <summary>
    /// Apply the country shortcut where the holiday profile JSON is null
    /// but a country is set somewhere in the chain. Returns the materialised
    /// <see cref="OrgHolidayProfile"/> + <see cref="OrgScheduleConfig"/>
    /// ready to feed into the pure resolvers.
    /// </summary>
    public static (OrgScheduleConfig schedule, OrgHolidayProfile holidays) Materialise(
        ResolvedPolicy resolved) {
        var schedule = TryParseSchedule(resolved.ScheduleConfigJson) ?? SchedulePresets.Default;

        OrgHolidayProfile? holidays = TryParseHolidays(resolved.HolidayProfileJson);
        if (holidays is null && !string.IsNullOrWhiteSpace(resolved.HolidayCountry)) {
            // Country shortcut — translate ISO-3166-1 alpha-2 to a preset key.
            var presetKey = HolidayCountries.PresetKeyForIso(resolved.HolidayCountry);
            if (presetKey is not null) {
                holidays = new OrgHolidayProfile { Preset = presetKey };
            }
        }
        holidays ??= new OrgHolidayProfile { Preset = HolidayPresets.DefaultKey };

        return (schedule, holidays);
    }

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

    // Single ancestor-chain query. Returns the leaf first, then each
    // parent until null. Scoped to the org so a cross-org id can't
    // leak another org's tree. The 32-row LIMIT here is a defensive
    // backstop — actual cycle handling lives in the walk loop above.
    private sealed record ChainNode(
        Guid Id, Guid? ParentProjectId, string Name,
        string? ScheduleConfig, string? HolidayProfile, string? HolidayCountry);

    private async Task<List<ChainNode>> LoadAncestorChainAsync(
        Guid orgId, Guid projectId, CancellationToken ct) {
        // Pull every project in the org into a tiny shape, then walk in
        // memory. Org-wide project count is small and this avoids round-
        // tripping per level of the tree. The same data is already cached
        // implicitly under org:{orgId}:projects in other code paths, but
        // we don't reuse that cache here because it carries a richer DTO.
        var byId = await _db.NativeProjects.AsNoTracking()
            .Where(p => p.OrgId == orgId)
            .Select(p => new ChainNode(
                p.Id, p.ParentProjectId, p.Name,
                p.ScheduleConfig, p.HolidayProfile, p.HolidayCountry))
            .ToDictionaryAsync(p => p.Id, ct);

        var chain = new List<ChainNode>(8);
        var seen = new HashSet<Guid>();
        var cursor = (Guid?)projectId;
        while (cursor is Guid id && chain.Count <= MaxAncestorDepth) {
            if (!byId.TryGetValue(id, out var node)) break;
            if (!seen.Add(id)) {
                // Cycle in the tree — log and stop walking. This should
                // never happen but I7 cycle prevention is not yet in
                // place on the re-parent path.
                _log.LogWarning(
                    "ProjectPolicyResolver detected a parent_project_id cycle through {ProjectId} (org {OrgId}).",
                    id, orgId);
                break;
            }
            chain.Add(node);
            cursor = node.ParentProjectId;
        }
        return chain;
    }

    private static ResolvedPolicy DefaultsOnly() => new(
        ScheduleConfigJson: null, ScheduleSource: "default", ScheduleSourceProjectId: null,
        HolidayProfileJson: null, HolidaySource: "default", HolidaySourceProjectId: null,
        HolidayCountry: null, HolidayCountrySource: "default", HolidayCountrySourceProjectId: null);
}

// ISO-3166-1 alpha-2 -> HolidayPresets key map. Closed set today (only
// "portugal" preset ships); adding ES/FR/IE/GB/US lookup is forward-
// compatible — when a preset lands in HolidayPresets, no change here is
// required because the keys already point at the eventual preset name.
public static class HolidayCountries {
    public sealed record Country(string Iso, string PresetKey, string DisplayName);

    public static readonly IReadOnlyList<Country> All = new[] {
        new Country("PT", "portugal", "Portugal"),
        new Country("ES", "spain", "Espanha"),
        new Country("FR", "france", "Franca"),
        new Country("IE", "ireland", "Irlanda"),
        new Country("GB", "united_kingdom", "Reino Unido"),
        new Country("US", "united_states", "Estados Unidos"),
    };

    private static readonly Dictionary<string, Country> ByIso =
        All.ToDictionary(c => c.Iso, StringComparer.OrdinalIgnoreCase);

    public static bool IsKnownIso(string? iso) =>
        !string.IsNullOrWhiteSpace(iso) && ByIso.ContainsKey(iso);

    public static string? PresetKeyForIso(string? iso) =>
        iso is not null && ByIso.TryGetValue(iso, out var c) ? c.PresetKey : null;
}
