namespace TimeFlow.Domain.Schedule;

// A windowed override on the fallback schedule. Both boundaries are
// MM-DD only (year omitted) so a single config covers every year
// without re-editing. Inclusive on both ends.
//
// Year-wrap: if `From > To` (e.g. From=11-01, To=02-28) the window
// crosses New Year — Nov + Dec + Jan + Feb. ScheduleResolver handles
// this; SchedulePeriod just records the raw bounds.
//
// Naming: `Summer`, `Winter`, `Q4Crunch`, whatever. Used in audit
// payloads + UI labels.
public sealed record SchedulePeriod {
    /// <summary>Human-readable label for the UI + audit log.</summary>
    public string Name { get; init; } = string.Empty;
    /// <summary>Inclusive start (year ignored, only month + day matter).</summary>
    public MonthDay From { get; init; }
    /// <summary>Inclusive end (year ignored). If &lt; From, the window wraps the year boundary.</summary>
    public MonthDay To { get; init; }
    /// <summary>Hours per weekday inside the window.</summary>
    public WeekdayHours Hours { get; init; } = new();
}

/// <summary>Calendar (month, day) tuple — like DateOnly but year-less.</summary>
public readonly record struct MonthDay(int Month, int Day) : IComparable<MonthDay> {
    public int CompareTo(MonthDay other) {
        var m = Month.CompareTo(other.Month);
        return m != 0 ? m : Day.CompareTo(other.Day);
    }

    /// <summary>True when this MonthDay falls within [from, to], year-wrap aware.</summary>
    public bool IsWithin(MonthDay from, MonthDay to) {
        var fromCmp = CompareTo(from);
        var toCmp = CompareTo(to);
        if (from.CompareTo(to) <= 0) {
            // Normal: from <= to. Within iff this >= from AND this <= to.
            return fromCmp >= 0 && toCmp <= 0;
        }
        // Wrapped: from > to means the window crosses Jan 1. We're inside
        // iff we're at-or-after `from` OR at-or-before `to`.
        return fromCmp >= 0 || toCmp <= 0;
    }

    public static MonthDay FromDate(DateOnly date) => new(date.Month, date.Day);
}
