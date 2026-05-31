namespace TimeFlow.Domain.Schedule;

// The full per-org schedule config. JSON-serialised into
// `organisations.schedule_config`. Null on the column = "use the
// built-in PT-IRN default" (Phase 5 stored an opaque payload; this
// type makes it concrete).
//
// Resolution policy:
//   1. Walk `Periods` in order, last-wins (i.e. a later period overrides
//      an earlier one if both match the date).
//   2. If no period matches, fall back to `Fallback`.
//
// "Last wins on overlap" matches the legacy TS contract and lets users
// stack a generic Winter rule then a more specific Q4Crunch on top.
public sealed record OrgScheduleConfig {
    public WeekdayHours Fallback { get; init; } = new();
    public IReadOnlyList<SchedulePeriod> Periods { get; init; } = Array.Empty<SchedulePeriod>();
}
