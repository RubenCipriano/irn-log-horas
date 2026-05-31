namespace TimeFlow.Domain.Schedule;

// Hours expected per weekday. Mon..Sun cover the whole grid; 0 means
// "no work expected" (typical weekend). Decimal so half-day Fridays
// (4.5) and similar arrangements are representable without a float
// round-trip surprise.
//
// Construct via the records-shorthand `new WeekdayHours { Mon = 7, ... }`;
// fields are init-only so values are effectively immutable after
// deserialise. Validation is done by the API layer (caps at 0..24).
public sealed record WeekdayHours {
    public decimal Mon { get; init; }
    public decimal Tue { get; init; }
    public decimal Wed { get; init; }
    public decimal Thu { get; init; }
    public decimal Fri { get; init; }
    public decimal Sat { get; init; }
    public decimal Sun { get; init; }

    public decimal For(DayOfWeek dow) => dow switch {
        DayOfWeek.Monday => Mon,
        DayOfWeek.Tuesday => Tue,
        DayOfWeek.Wednesday => Wed,
        DayOfWeek.Thursday => Thu,
        DayOfWeek.Friday => Fri,
        DayOfWeek.Saturday => Sat,
        DayOfWeek.Sunday => Sun,
        _ => 0m,
    };
}
