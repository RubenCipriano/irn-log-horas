namespace TimeFlow.Domain.Holidays;

// One holiday rule. Two flavours:
//   * Fixed(Month, Day): Christmas, Republic Day, etc. — same date
//     every year.
//   * EasterOffset(Days): Good Friday = Easter - 2, Corpus Christi =
//     Easter + 60, etc. Easter itself = offset 0.
//
// `Name` is human-readable for UI + audit. `Region` is the preset key
// the rule came from (e.g. "portugal" or "portugal:madeira") — useful
// for filtering when a profile pulls from a national preset but the
// user wants to scope by sub-region.
public abstract record HolidayRule(string Name, string Region) {
    /// <summary>Materialise the rule into a concrete date for the given year.</summary>
    public abstract DateOnly DateFor(int year);
}

public sealed record FixedDateHoliday(string Name, string Region, int Month, int Day) : HolidayRule(Name, Region) {
    public override DateOnly DateFor(int year) => new(year, Month, Day);
}

public sealed record EasterOffsetHoliday(string Name, string Region, int OffsetDays) : HolidayRule(Name, Region) {
    public override DateOnly DateFor(int year) =>
        EasterMath.WesternEasterSunday(year).AddDays(OffsetDays);
}

// Materialised holiday — the output of HolidayResolver.
public sealed record ResolvedHoliday(DateOnly Date, string Name, string Region);
