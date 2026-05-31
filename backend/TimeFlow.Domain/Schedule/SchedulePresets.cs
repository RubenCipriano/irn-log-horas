namespace TimeFlow.Domain.Schedule;

// Built-in schedule presets. The legacy stack carried "PT-IRN" (a
// Portuguese consultancy schedule) as the only preset; future regions
// land as additional dictionary entries.
//
// Lookup by lowercase key (`"pt-irn"`); unknown keys return null so the
// API layer can fall back gracefully.
public static class SchedulePresets {
    /// <summary>Portuguese consultancy default. Summer Mon-Thu=7h, Fri=9h; Winter all=9h.</summary>
    public static readonly OrgScheduleConfig PtIrn = new() {
        // Fallback = winter shape (no Summer override matches).
        Fallback = new WeekdayHours { Mon = 9, Tue = 9, Wed = 9, Thu = 9, Fri = 9 },
        Periods = new[] {
            new SchedulePeriod {
                Name = "Verao",
                From = new MonthDay(6, 15),
                To = new MonthDay(9, 15),
                Hours = new WeekdayHours { Mon = 7, Tue = 7, Wed = 7, Thu = 7, Fri = 9 },
            },
        },
    };

    private static readonly Dictionary<string, OrgScheduleConfig> ByKey = new(StringComparer.OrdinalIgnoreCase) {
        ["pt-irn"] = PtIrn,
    };

    /// <summary>Lookup. Returns null for unknown keys.</summary>
    public static OrgScheduleConfig? Get(string key) =>
        string.IsNullOrWhiteSpace(key) ? null : ByKey.GetValueOrDefault(key);

    /// <summary>Used by the API when an org has no custom config.</summary>
    public static OrgScheduleConfig Default => PtIrn;
}
