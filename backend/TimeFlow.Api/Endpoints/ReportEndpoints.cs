using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using TimeFlow.Auth;
using TimeFlow.Data;
using TimeFlow.Rbac;

namespace TimeFlow.Api.Endpoints;

// Phase 11 — billing-friendly CSV export of worklogs.
//
// One endpoint today (per-user export gated on WorklogsReadOwn; org-wide
// gated on WorklogsReadOrg via ?userId=… or absence). Future surfaces
// (per-project, per-client) land as additional endpoints reusing the
// same CSV serialisation helper.
//
// Output format — Excel-friendly UTF-8 with BOM + CRLF row endings.
// Columns: date, hours, project_id, task_id, upstream_project_id,
// upstream_task_id, source, notes (with CSV quoting for embedded commas
// / quotes / newlines). Upstream IDs come from the worklog's task /
// project (mirror tuple lives on `native_tasks` / `native_projects` since
// Phase C) so worklogs imported from OpenProject etc. carry a stable
// reconciliation key for downstream tools.
public static class ReportEndpoints {
    public static void MapReportEndpoints(this WebApplication app) {
        var grp = app.MapGroup("/api/orgs/{id:guid}/worklogs").RequireAuthorization();
        grp.MapGet("/export.csv", ExportCsv)
            .RequireOrgPermission(Permission.WorklogsReadOwn)
            .RequireRateLimiting(RateLimitPolicies.Expensive);
    }

    // Hard cap on rows per export — prevents an attacker from triggering
    // a multi-GB CSV download. At 8h/day for 5 years that's ~14,600 rows
    // for a fully utilised user; 50k leaves headroom for power users
    // without inviting OOM. Use COUNT first to refuse early.
    private const int MaxExportRows = 50_000;

    public static async Task<IResult> ExportCsv(
        Guid id,
        DateOnly? from, DateOnly? to, Guid? userId,
        TimeFlowDbContext db,
        HttpContext http,
        CancellationToken ct) {
        var (orgId, role) = http.RequireOrgContext();
        var callerId = AuthClaims.GetUserId(http.User);
        if (callerId is null) return Results.Unauthorized();

        var target = userId ?? callerId.Value;
        if (target != callerId.Value && !PermissionMatrix.Can(role, Permission.WorklogsReadOrg)) {
            return Results.Forbid();
        }

        var fromDate = from ?? new DateOnly(DateTime.UtcNow.Year, 1, 1);
        var toDate = to ?? new DateOnly(DateTime.UtcNow.Year, 12, 31);
        if (toDate < fromDate) return Results.Json(new { error = "to < from." }, statusCode: 400);
        // Caps at 5 years — anyone wanting more should hit pagination
        // (which Phase 11 doesn't add — defer when the first user complains).
        if ((toDate.DayNumber - fromDate.DayNumber) > 5 * 366) {
            return Results.Json(new { error = "Range too wide (max 5 years)." }, statusCode: 400);
        }

        var baseQuery = db.Worklogs.AsNoTracking()
            .Where(w => w.OrgId == orgId && w.UserId == target
                && w.WorkDate >= fromDate && w.WorkDate <= toDate);

        // Refuse early when the result set would blow the memory budget.
        // COUNT(*) on indexed (org_id, user_id, work_date) is cheap even
        // at scale; cheaper than starting the export and aborting.
        var rowCount = await baseQuery.CountAsync(ct);
        if (rowCount > MaxExportRows) {
            return Results.Json(new {
                error = $"Result set too large ({rowCount} rows; max {MaxExportRows}). Narrow the date range or split into chunks.",
            }, statusCode: 413);
        }

        var rowsQuery = baseQuery
            .OrderBy(w => w.WorkDate).ThenBy(w => w.CreatedAt)
            .Select(w => new {
                w.WorkDate, w.Hours, w.ProjectId, w.TaskId,
                // Mirror tuple resolution after Phase C: the natural ids
                // live on `native_tasks` (upstream task id) and on the
                // task's `native_projects` row (upstream project id).
                // Walk through TaskId when set; fall back to ProjectId for
                // worklogs logged directly against a project.
                UpstreamProjectId = w.TaskId != null
                    ? db.NativeTasks.Where(t => t.Id == w.TaskId)
                        .Select(t => db.NativeProjects
                            .Where(p => p.Id == t.ProjectId)
                            .Select(p => p.UpstreamProjectId)
                            .FirstOrDefault())
                        .FirstOrDefault()
                    : (w.ProjectId != null
                        ? db.NativeProjects.Where(p => p.Id == w.ProjectId)
                            .Select(p => p.UpstreamProjectId).FirstOrDefault()
                        : null),
                UpstreamTaskNaturalId = w.TaskId != null
                    ? db.NativeTasks.Where(t => t.Id == w.TaskId)
                        .Select(t => t.UpstreamTaskId).FirstOrDefault()
                    : null,
                w.Source, w.Notes,
            });

        var filename = $"worklogs-{target:N}-{fromDate:yyyyMMdd}-{toDate:yyyyMMdd}.csv";
        // Stream the CSV row-by-row into the response body. No StringBuilder,
        // no Encoding.GetBytes — memory stays O(1) regardless of result size.
        return Results.Stream(async stream => {
            await using var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
            await writer.WriteAsync("date,hours,project_id,task_id,upstream_project_id,upstream_task_id,source,notes\r\n");
            await foreach (var r in rowsQuery.AsAsyncEnumerable().WithCancellation(ct)) {
                await writer.WriteAsync(r.WorkDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
                await writer.WriteAsync(',');
                await writer.WriteAsync(r.Hours.ToString("0.00", CultureInfo.InvariantCulture));
                await writer.WriteAsync(',');
                await writer.WriteAsync(r.ProjectId?.ToString() ?? "");
                await writer.WriteAsync(',');
                await writer.WriteAsync(r.TaskId?.ToString() ?? "");
                await writer.WriteAsync(',');
                await writer.WriteAsync(CsvQuote(r.UpstreamProjectId));
                await writer.WriteAsync(',');
                await writer.WriteAsync(CsvQuote(r.UpstreamTaskNaturalId));
                await writer.WriteAsync(',');
                await writer.WriteAsync(CsvQuote(r.Source));
                await writer.WriteAsync(',');
                await writer.WriteAsync(CsvQuote(r.Notes));
                await writer.WriteAsync("\r\n");
            }
            await writer.FlushAsync();
        }, contentType: "text/csv; charset=utf-8", fileDownloadName: filename);
    }

    /// <summary>RFC 4180 quoting — wrap in quotes when value contains comma / quote / newline; double embedded quotes.</summary>
    private static string CsvQuote(string? value) {
        if (string.IsNullOrEmpty(value)) return "";
        if (value.IndexOfAny(new[] { ',', '"', '\r', '\n' }) < 0) return value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}
