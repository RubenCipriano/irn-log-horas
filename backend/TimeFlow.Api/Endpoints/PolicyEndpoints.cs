using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/policy — schedule + holiday profile JSON.
//
// We store BOTH as `text` columns containing serialised JSON. The
// shape is owned by TimeFlow.Domain (Phase 6) — Phase 5 treats them as
// opaque payloads with a structural validator (size caps + JSON parses)
// so a future Domain update can swap shape without a schema migration.
//
// Null payload = "use the built-in default". The frontend handles the
// null case by hydrating the preset client-side.
public static class PolicyEndpoints {
    // Caps from CLAUDE.md plan 015 — defensive ceilings, not business logic.
    private const int MaxJsonBytes = 32 * 1024;

    public static void MapPolicyEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/policy").RequireAuthorization();

        // Reads are viewer+ (OrgRead) — same surface that lets you see
        // your hours grid uses the policy to render expected-hours.
        grp.MapGet("", Get).RequireOrgPermission(Permission.OrgRead);
        // Writes are owner+ — schedule + holiday changes affect billing,
        // approval thresholds, and audit reports. Tight gate on purpose.
        grp.MapPatch("", Update).RequireOrgPermission(Permission.OrgUpdate);
    }

    public sealed record PolicyResponse(string? ScheduleConfig, string? HolidayProfile, DateTime UpdatedAt);

    // ---------------------------------------------------------------------
    // GET /api/orgs/{id}/policy
    // ---------------------------------------------------------------------
    public static async Task<IResult> Get(
        Guid id,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var policy = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:policy",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { MembershipCacheTags.OrgPolicy(orgId) },
            loader: async ct2 => await db.Organisations
                .Where(o => o.Id == orgId)
                .Select(o => new PolicyResponse(o.ScheduleConfigJson, o.HolidayProfileJson, o.UpdatedAt))
                .FirstOrDefaultAsync(ct2),
            ct: ct);
        if (policy is null) return Results.NotFound();
        return Results.Ok(policy);
    }

    // ---------------------------------------------------------------------
    // PATCH /api/orgs/{id}/policy — set schedule and/or holiday profile
    // ---------------------------------------------------------------------
    // `null` means "explicit reset to default". To leave a field unchanged,
    // OMIT it from the JSON body (these are nullable + the wrapper bools
    // are how we express tri-state).
    public sealed record UpdatePolicyRequest(
        bool SetSchedule,
        string? ScheduleConfig,
        bool SetHolidays,
        string? HolidayProfile);

    public static async Task<IResult> Update(
        Guid id,
        UpdatePolicyRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        if (body.SetSchedule) {
            if (!ValidateJsonPayload(body.ScheduleConfig, out var err)) {
                return Results.Json(new { error = $"scheduleConfig: {err}" }, statusCode: 400);
            }
        }
        if (body.SetHolidays) {
            if (!ValidateJsonPayload(body.HolidayProfile, out var err)) {
                return Results.Json(new { error = $"holidayProfile: {err}" }, statusCode: 400);
            }
        }

        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == orgId, ct);
        if (org is null) return Results.NotFound();

        var diff = new {
            schedule = body.SetSchedule ? new { from = org.ScheduleConfigJson, to = body.ScheduleConfig } : null,
            holidays = body.SetHolidays ? new { from = org.HolidayProfileJson, to = body.HolidayProfile } : null,
        };

        if (body.SetSchedule) org.ScheduleConfigJson = body.ScheduleConfig;
        if (body.SetHolidays) org.HolidayProfileJson = body.HolidayProfile;
        org.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] { MembershipCacheTags.OrgPolicy(orgId) }, ct);
        await audit.RecordAsync("org.policy_changed", orgId, callerId, "org", orgId.ToString(), diff, ct);

        return Results.Ok(new PolicyResponse(org.ScheduleConfigJson, org.HolidayProfileJson, org.UpdatedAt));
    }

    private static bool ValidateJsonPayload(string? payload, out string error) {
        error = "";
        if (payload is null) return true; // null = reset

        var bytes = System.Text.Encoding.UTF8.GetByteCount(payload);
        if (bytes > MaxJsonBytes) {
            error = $"too large ({bytes} bytes, max {MaxJsonBytes}).";
            return false;
        }
        try {
            using var _ = JsonDocument.Parse(payload);
            return true;
        } catch (JsonException ex) {
            error = $"invalid JSON: {ex.Message}";
            return false;
        }
    }
}
