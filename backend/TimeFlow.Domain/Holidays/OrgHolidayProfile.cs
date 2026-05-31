namespace TimeFlow.Domain.Holidays;

// Per-org holiday selection. Composed in three layers:
//   * `Preset` — pulls in a regional rule set (e.g. "portugal" national).
//     Null = no preset; rely on additions only.
//   * `Additions` — extra holidays the org observes on top of the preset
//     (e.g. company anniversary).
//   * `Exclusions` — preset entries the org does NOT observe (e.g. an
//     office that ignores a regional holiday). Matched by `Name` AND
//     `Region` so two presets with same-named different-region rules
//     don't collide.
//
// JSON-serialised into `organisations.holiday_profile`. Null on the
// column = HolidayPresets.Default ("portugal").
public sealed record OrgHolidayProfile {
    /// <summary>Preset key, lowercase. Null = no national preset.</summary>
    public string? Preset { get; init; }
    public IReadOnlyList<HolidayAddition> Additions { get; init; } = Array.Empty<HolidayAddition>();
    public IReadOnlyList<HolidayExclusion> Exclusions { get; init; } = Array.Empty<HolidayExclusion>();
}

/// <summary>Extra holiday to add on top of the preset.</summary>
public sealed record HolidayAddition(string Name, int Month, int Day);

/// <summary>Preset entry to suppress. Matched by (Name, Region) tuple.</summary>
public sealed record HolidayExclusion(string Name, string Region);
