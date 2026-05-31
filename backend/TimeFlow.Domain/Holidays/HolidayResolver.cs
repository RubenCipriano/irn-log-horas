namespace TimeFlow.Domain.Holidays;

// Materialises an OrgHolidayProfile into the concrete set of dates
// that count as holidays for a given year. Pure function — caller
// caches the result if they want to.
//
// Resolution order:
//   1. Pull rules from the preset (or empty if no preset).
//   2. Drop any preset rule whose (Name, Region) appears in Exclusions.
//   3. Materialise to dates for the requested year.
//   4. Add the Additions (treated as Region "custom").
//   5. Dedupe by Date (a custom addition that lands on an Easter date
//      shouldn't double-count). Preset wins on collision because the
//      label is usually more informative.
public static class HolidayResolver {
    public static IReadOnlyList<ResolvedHoliday> ResolveForYear(OrgHolidayProfile profile, int year) {
        var exclusionSet = new HashSet<(string Name, string Region)>(
            profile.Exclusions.Select(e => (e.Name, e.Region)));

        var fromPreset = HolidayPresets.Get(profile.Preset)
            .Where(r => !exclusionSet.Contains((r.Name, r.Region)))
            .Select(r => new ResolvedHoliday(r.DateFor(year), r.Name, r.Region));

        var additions = profile.Additions
            .Select(a => new ResolvedHoliday(new DateOnly(year, a.Month, a.Day), a.Name, "custom"));

        // Dedupe by date; preset wins on collision (its label tends to be
        // more informative than a generic "Company day").
        var byDate = new Dictionary<DateOnly, ResolvedHoliday>();
        foreach (var h in fromPreset) byDate[h.Date] = h;
        foreach (var h in additions) byDate.TryAdd(h.Date, h);

        return byDate.Values.OrderBy(h => h.Date).ToList();
    }

    /// <summary>True when the date falls on a profile-resolved holiday for its year.</summary>
    public static bool IsHoliday(DateOnly date, OrgHolidayProfile profile) =>
        ResolveForYear(profile, date.Year).Any(h => h.Date == date);
}
