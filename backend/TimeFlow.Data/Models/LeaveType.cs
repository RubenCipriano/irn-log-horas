namespace TimeFlow.Data.Models;

// Reference table: leave types an org offers (vacation, sick, parental,
// jury duty, etc.). The day-fill UI picks one when a user marks a day
// as "leave" instead of work. `DefaultHours` lets a half-day type
// auto-fill 4h while a full-day fills the schedule's expected.
public sealed class LeaveType {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrgId { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>True if these hours count toward billable + payroll.</summary>
    public bool Paid { get; set; } = true;

    /// <summary>Null = "use the day's expected hours from the schedule".</summary>
    public decimal? DefaultHours { get; set; }

    public string? Color { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
