using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Api.Services;
using TimeFlow.Auth;
using TimeFlow.Cache;
using TimeFlow.Data;
using TimeFlow.Data.Models;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// /api/orgs/{id}/projects/{projectId}/tasks — native task CRUD.
//
// Lives one level below projects so the parent project's existence +
// org match is implicit in the URL — we still re-check inside each
// handler because URL forgery is cheap.
public static class TaskEndpoints {
    public static void MapTaskEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/projects/{projectId:guid}/tasks")
            .RequireAuthorization();

        grp.MapGet("", List).RequireOrgPermission(Permission.TasksRead);
        grp.MapPost("", Create).RequireOrgPermission(Permission.TasksWrite);
        grp.MapPatch("/{taskId:guid}", Update).RequireOrgPermission(Permission.TasksWrite);
        grp.MapDelete("/{taskId:guid}", Delete).RequireOrgPermission(Permission.TasksWrite);
    }

    public sealed record TaskItem(
        Guid Id, Guid ProjectId, string Title, string? Description, string Status,
        Guid? AssigneeId, DateTime CreatedAt, DateTime UpdatedAt);

    public static async Task<IResult> List(
        Guid id, Guid projectId,
        bool? includeDescendants,
        TimeFlowDbContext db,
        ICacheStore cache,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var projectExists = await db.NativeProjects.AnyAsync(p => p.Id == projectId && p.OrgId == orgId, ct);
        if (!projectExists) return Results.NotFound();

        // `includeDescendants=true` rolls up tasks from the engagement's
        // entire subtree (wrapper projects + mirrored upstream sub-projects
        // + their children, recursively) into the engagement's Tasks tab.
        // Uses a Postgres recursive CTE so the tree can be arbitrarily deep
        // — the typical shape is engagement → wrapper → upstream subs.
        var rollUp = includeDescendants == true;
        var tasks = await cache.GetOrSetAsync(
            key: rollUp
                ? $"org:{orgId:N}:tasks:project:{projectId:N}:rolled"
                : $"org:{orgId:N}:tasks:project:{projectId:N}",
            ttl: TimeSpan.FromMinutes(2),
            tags: new[] { $"org:{orgId:N}:tasks" },
            loader: async ct2 => {
                if (rollUp) {
                    var projectIds = await ProjectTreeHelper.DescendantProjectIdsAsync(db, orgId, projectId, ct2);
                    return await db.NativeTasks
                        .Where(t => projectIds.Contains(t.ProjectId))
                        .OrderBy(t => t.CreatedAt)
                        .Select(t => new TaskItem(t.Id, t.ProjectId, t.Title, t.Description, t.Status, t.AssigneeId, t.CreatedAt, t.UpdatedAt))
                        .ToListAsync(ct2);
                }
                return await db.NativeTasks
                    .Where(t => t.ProjectId == projectId)
                    .OrderBy(t => t.CreatedAt)
                    .Select(t => new TaskItem(t.Id, t.ProjectId, t.Title, t.Description, t.Status, t.AssigneeId, t.CreatedAt, t.UpdatedAt))
                    .ToListAsync(ct2);
            },
            ct: ct);
        return Results.Ok(tasks);
    }

    public sealed record CreateTaskRequest(
        [Required, MinLength(2), MaxLength(200)] string Title,
        string? Description,
        string? Status,
        Guid? AssigneeId);

    public static async Task<IResult> Create(
        Guid id, Guid projectId,
        CreateTaskRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        if (!MiniValidator.TryValidate(body, out var errors)) {
            return Results.ValidationProblem(errors);
        }
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var projectExists = await db.NativeProjects.AnyAsync(p => p.Id == projectId && p.OrgId == orgId, ct);
        if (!projectExists) return Results.NotFound();

        var task = new NativeTask {
            ProjectId = projectId,
            OrgId = orgId,
            Title = body.Title.Trim(),
            Description = body.Description,
            Status = string.IsNullOrWhiteSpace(body.Status) ? "open" : body.Status.Trim().ToLowerInvariant(),
            AssigneeId = body.AssigneeId,
            CreatedBy = callerId,
        };
        db.NativeTasks.Add(task);
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:tasks" }, ct);
        await audit.RecordAsync("task.created", orgId, callerId, "task", task.Id.ToString(),
            new { title = task.Title, projectId, status = task.Status }, ct);

        return Results.Ok(new TaskItem(task.Id, task.ProjectId, task.Title, task.Description, task.Status,
            task.AssigneeId, task.CreatedAt, task.UpdatedAt));
    }

    public sealed record UpdateTaskRequest(
        [MinLength(2), MaxLength(200)] string? Title,
        string? Description,
        string? Status,
        bool SetAssignee,
        Guid? AssigneeId);

    public static async Task<IResult> Update(
        Guid id, Guid projectId, Guid taskId,
        UpdateTaskRequest body,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var task = await db.NativeTasks
            .FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == projectId && t.OrgId == orgId, ct);
        if (task is null) return Results.NotFound();

        if (!string.IsNullOrWhiteSpace(body.Title)) task.Title = body.Title.Trim();
        if (body.Description is not null) task.Description = body.Description;
        if (!string.IsNullOrWhiteSpace(body.Status)) task.Status = body.Status.Trim().ToLowerInvariant();
        if (body.SetAssignee) task.AssigneeId = body.AssigneeId;
        task.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:tasks" }, ct);
        await audit.RecordAsync("task.updated", orgId, callerId, "task", task.Id.ToString(),
            new { title = task.Title, status = task.Status, assigneeId = task.AssigneeId }, ct);

        return Results.Ok(new TaskItem(task.Id, task.ProjectId, task.Title, task.Description, task.Status,
            task.AssigneeId, task.CreatedAt, task.UpdatedAt));
    }

    public static async Task<IResult> Delete(
        Guid id, Guid projectId, Guid taskId,
        TimeFlowDbContext db,
        ICacheStore cache,
        IAuditLogger audit,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, _) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);

        var task = await db.NativeTasks
            .FirstOrDefaultAsync(t => t.Id == taskId && t.ProjectId == projectId && t.OrgId == orgId, ct);
        if (task is null) return Results.NotFound();

        // Tasks delete cleanly; worklog FK to task is ON DELETE SET NULL
        // so existing hour entries stay in place (project FK preserves
        // the billing relationship).
        db.NativeTasks.Remove(task);
        await db.SaveChangesAsync(ct);

        await cache.InvalidateTagsAsync(new[] { $"org:{orgId:N}:tasks" }, ct);
        await audit.RecordAsync("task.deleted", orgId, callerId, "task", task.Id.ToString(),
            new { title = task.Title }, ct);

        return Results.Ok(new { ok = true });
    }
}
