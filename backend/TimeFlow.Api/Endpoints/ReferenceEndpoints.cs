using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/leave-types and /api/orgs/{id}/hour-types — small
// reference tables every org configures once. CRUD-light: list + create
// + delete. Edits are rare and can land via "delete + recreate" until
// someone needs them inline.
public static class ReferenceEndpoints {
    public static void MapReferenceEndpoints(this WebApplication app) {
        var leave = app.MapGroup("/api/orgs/{id:guid}/leave-types").RequireAuthorization();
        leave.MapGet("", ListLeaveTypes).RequireOrgPermission(Permission.OrgRead);
        leave.MapPost("", CreateLeaveType).RequireOrgPermission(Permission.OrgUpdate);
        leave.MapDelete("/{typeId:guid}", DeleteLeaveType).RequireOrgPermission(Permission.OrgUpdate);

        var hour = app.MapGroup("/api/orgs/{id:guid}/hour-types").RequireAuthorization();
        hour.MapGet("", ListHourTypes).RequireOrgPermission(Permission.OrgRead);
        hour.MapPost("", CreateHourType).RequireOrgPermission(Permission.OrgUpdate);
        hour.MapDelete("/{typeId:guid}", DeleteHourType).RequireOrgPermission(Permission.OrgUpdate);
    }

    // ----- Leave types ---------------------------------------------------
    public sealed record LeaveTypeItem(Guid Id, string Name, bool Paid, decimal? DefaultHours, string? Color);

    public static async Task<IResult> ListLeaveTypes(Guid id, TimeFlowDbContext db, ICacheStore cache, HttpContext http, CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var items = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:reference:leave-types",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:reference" },
            loader: async ct2 => await db.LeaveTypes
                .Where(x => x.OrgId == orgId)
                .OrderBy(x => x.Name)
                .Select(x => new LeaveTypeItem(x.Id, x.Name, x.Paid, x.DefaultHours, x.Color))
                .ToListAsync(ct2),
            ct: ct);
        return Results.Ok(items);
    }

    public sealed record CreateLeaveTypeRequest(
        [Required, MinLength(2), MaxLength(80)] string Name,
        bool Paid,
        [Range(0.0, 24.0)] decimal? DefaultHours,
        [MaxLength(20)] string? Color);

    public static async Task<IResult> CreateLeaveType(
        Guid id, CreateLeaveTypeRequest body,
        TimeFlowDbContext db, ICacheStore cache, IAuditLogger audit, HttpContext http, CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) return Results.ValidationProblem(errors);
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var item = new LeaveType {
            OrgId = orgId,
            Name = body.Name.Trim(),
            Paid = body.Paid,
            DefaultHours = body.DefaultHours,
            Color = body.Color,
        };
        db.LeaveTypes.Add(item);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex)) {
            return Results.Conflict(new { error = "A leave type with that name already exists." });
        }
        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:reference" }, ct);
        await audit.RecordAsync("leave_type.created", orgId, callerId, "leave_type", item.Id.ToString(),
            new { name = item.Name, paid = item.Paid }, ct);
        return Results.Ok(new LeaveTypeItem(item.Id, item.Name, item.Paid, item.DefaultHours, item.Color));
    }

    public static async Task<IResult> DeleteLeaveType(
        Guid id, Guid typeId, TimeFlowDbContext db, ICacheStore cache, IAuditLogger audit, HttpContext http, CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        var item = await db.LeaveTypes.FirstOrDefaultAsync(x => x.Id == typeId && x.OrgId == orgId, ct);
        if (item is null) return Results.NotFound();
        db.LeaveTypes.Remove(item);
        await db.SaveChangesAsync(ct);
        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:reference" }, ct);
        await audit.RecordAsync("leave_type.deleted", orgId, callerId, "leave_type", item.Id.ToString(),
            new { name = item.Name }, ct);
        return Results.Ok(new { ok = true });
    }

    // ----- Hour types ----------------------------------------------------
    public sealed record HourTypeItem(Guid Id, string Name, bool Billable, string? Color);

    public static async Task<IResult> ListHourTypes(Guid id, TimeFlowDbContext db, ICacheStore cache, HttpContext http, CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var items = await cache.GetOrSetAsync(
            key: $"org:{orgId:N}:reference:hour-types",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:reference" },
            loader: async ct2 => await db.HourTypes
                .Where(x => x.OrgId == orgId)
                .OrderBy(x => x.Name)
                .Select(x => new HourTypeItem(x.Id, x.Name, x.Billable, x.Color))
                .ToListAsync(ct2),
            ct: ct);
        return Results.Ok(items);
    }

    public sealed record CreateHourTypeRequest(
        [Required, MinLength(2), MaxLength(80)] string Name,
        bool Billable,
        [MaxLength(20)] string? Color);

    public static async Task<IResult> CreateHourType(
        Guid id, CreateHourTypeRequest body,
        TimeFlowDbContext db, ICacheStore cache, IAuditLogger audit, HttpContext http, CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) return Results.ValidationProblem(errors);
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var item = new HourType {
            OrgId = orgId,
            Name = body.Name.Trim(),
            Billable = body.Billable,
            Color = body.Color,
        };
        db.HourTypes.Add(item);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex)) {
            return Results.Conflict(new { error = "An hour type with that name already exists." });
        }
        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:reference" }, ct);
        await audit.RecordAsync("hour_type.created", orgId, callerId, "hour_type", item.Id.ToString(),
            new { name = item.Name, billable = item.Billable }, ct);
        return Results.Ok(new HourTypeItem(item.Id, item.Name, item.Billable, item.Color));
    }

    public static async Task<IResult> DeleteHourType(
        Guid id, Guid typeId, TimeFlowDbContext db, ICacheStore cache, IAuditLogger audit, HttpContext http, CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        var item = await db.HourTypes.FirstOrDefaultAsync(x => x.Id == typeId && x.OrgId == orgId, ct);
        if (item is null) return Results.NotFound();
        db.HourTypes.Remove(item);
        await db.SaveChangesAsync(ct);
        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:reference" }, ct);
        await audit.RecordAsync("hour_type.deleted", orgId, callerId, "hour_type", item.Id.ToString(),
            new { name = item.Name }, ct);
        return Results.Ok(new { ok = true });
    }

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException pg && pg.SqlState == "23505";
}
