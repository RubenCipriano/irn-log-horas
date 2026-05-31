using TimeFlow.Domain.Holidays;

namespace TimeFlow.Domain.Schedule;

// Single entry point for "how many hours is this user expected to log
// on this date?" Pure function — no DB, no clock, no globals.
//
// Year-wrap is handled in MonthDay.IsWithin; this resolver just
// walks the periods last-wins and falls back if none match.
public static class ScheduleResolver {
    /// <summary>Hours expected on <paramref name="date"/> under the given config.</summary>
    public static decimal ResolveExpectedHours(DateOnly date, OrgScheduleConfig config) {
        var md = MonthDay.FromDate(date);
        var dow = date.DayOfWeek;

        // Walk periods in order; remember the last match.
        WeekdayHours? winning = null;
        foreach (var p in config.Periods) {
            if (md.IsWithin(p.From, p.To)) winning = p.Hours;
        }
        return (winning ?? config.Fallback).For(dow);
    }

    /// <summary>
    /// Holiday-aware overload. A date that resolves to a profile holiday
    /// returns 0 — otherwise it falls through to the schedule-only path
    /// above. Pass <c>null</c> for <paramref name="holidays"/> to keep
    /// the legacy behaviour (no holiday subtraction).
    /// </summary>
    public static decimal ResolveExpectedHours(
        DateOnly date, OrgScheduleConfig config, OrgHolidayProfile? holidays) {
        if (holidays is not null && HolidayResolver.IsHoliday(date, holidays)) return 0m;
        return ResolveExpectedHours(date, config);
    }

    /// <summary>Total expected hours over an inclusive date range.</summary>
    public static decimal SumExpectedHours(DateOnly from, DateOnly toInclusive, OrgScheduleConfig config) {
        if (toInclusive < from) return 0m;
        var total = 0m;
        for (var d = from; d <= toInclusive; d = d.AddDays(1)) {
            total += ResolveExpectedHours(d, config);
        }
        return total;
    }

    /// <summary>Holiday-aware variant of <see cref="SumExpectedHours"/>.</summary>
    public static decimal SumExpectedHours(
        DateOnly from, DateOnly toInclusive, OrgScheduleConfig config, OrgHolidayProfile? holidays) {
        if (toInclusive < from) return 0m;
        var total = 0m;
        for (var d = from; d <= toInclusive; d = d.AddDays(1)) {
            total += ResolveExpectedHours(d, config, holidays);
        }
        return total;
    }
}
