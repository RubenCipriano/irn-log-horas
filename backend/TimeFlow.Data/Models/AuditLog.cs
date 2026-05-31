namespace TimeFlow.Data.Models;

// Append-only event stream for security- and compliance-sensitive events.
// Org-scoped events (org.* / member.* / squad.* / integrations.*) carry
// `OrgId`; account-scoped events (account.password_changed, etc.) carry
// it null. `ActorId` is the user who performed the action; goes NULL via
// GDPR delete cascade.
//
// `PayloadJson` is a freeform JSON blob — usually a diff `{ from, to }`
// or whatever helps the support team reconstruct what changed. Schema
// per-action is enforced at the WRITE site, not by EF.
public sealed class AuditLog {
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? OrgId { get; set; }
    public Guid? ActorId { get; set; }
    public string Action { get; set; } = string.Empty;
    public string? TargetType { get; set; }
    public string? TargetId { get; set; }
    public string PayloadJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
