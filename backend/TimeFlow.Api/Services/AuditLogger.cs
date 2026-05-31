using System.Text.Json;
using TimeFlow.Data;
using TimeFlow.Data.Models;

namespace TimeFlow.Api.Services;

// Centralised audit-log writer. Endpoint code calls .RecordAsync(...);
// the helper handles serialisation + the createdAt clock so the schema
// stays uniform.
//
// Failure mode: NEVER throw. If the audit insert fails we still want
// the user-visible mutation to succeed (audit gaps are recoverable;
// rolling back a password change because the audit row didn't write
// would be silly). We rely on Postgres + our connection pool being
// healthy enough that this is a non-issue in practice.
public interface IAuditLogger {
    Task RecordAsync(
        string action,
        Guid? orgId,
        Guid? actorId,
        string? targetType = null,
        string? targetId = null,
        object? payload = null,
        CancellationToken ct = default);
}

public sealed class AuditLogger : IAuditLogger {
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly TimeFlowDbContext _db;
    private readonly ILogger<AuditLogger> _log;

    public AuditLogger(TimeFlowDbContext db, ILogger<AuditLogger> log) {
        _db = db;
        _log = log;
    }

    public async Task RecordAsync(
        string action,
        Guid? orgId,
        Guid? actorId,
        string? targetType = null,
        string? targetId = null,
        object? payload = null,
        CancellationToken ct = default) {
        try {
            _db.AuditLogs.Add(new AuditLog {
                OrgId = orgId,
                ActorId = actorId,
                Action = action,
                TargetType = targetType,
                TargetId = targetId,
                PayloadJson = payload is null ? "{}" : JsonSerializer.Serialize(payload, JsonOpts),
            });
            await _db.SaveChangesAsync(ct);
        } catch (Exception ex) {
            // Don't bubble — audit gaps are preferable to losing the
            // user's mutation. Log loudly so ops sees it.
            _log.LogWarning(ex, "Failed to write audit entry for action {Action}", action);
        }
    }
}
