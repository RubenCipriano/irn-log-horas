namespace TimeFlow.Data.Models;

// Reference table: categorisations of billable hours (e.g. "Dev",
// "Meeting", "Review", "Travel"). Reports group by these.
//
// Phase 6 adds the table + CRUD only. The worklog FK to hour-type
// lands when reports start needing it (Phase 11) — keeping the join
// optional now means workout-of-the-box still works.
public sealed class HourType {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrgId { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool Billable { get; set; } = true;
    public string? Color { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
