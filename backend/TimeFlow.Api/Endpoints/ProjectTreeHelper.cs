using Microsoft.EntityFrameworkCore;
using TimeFlow.Data;

namespace TimeFlow.Api.Endpoints;

// Shared helper for walking a project subtree. The hierarchy is at
// most three levels deep in v1 (engagement → wrapper → upstream
// sub-projects), but the recursive CTE keeps this future-proof for
// deeper trees without callers having to think about depth.
internal static class ProjectTreeHelper
{
    /// <summary>
    /// Returns every native_project id reachable from <paramref name="rootProjectId"/>
    /// by walking parent_project_id downward (the root itself is included).
    /// Scoped to <paramref name="orgId"/> defensively so a cross-org id leak
    /// can't enumerate another org's tree.
    /// </summary>
    public static async Task<List<Guid>> DescendantProjectIdsAsync(
        TimeFlowDbContext db, Guid orgId, Guid rootProjectId, CancellationToken ct = default)
    {
        const string sql = @"
            WITH RECURSIVE tree AS (
                SELECT id FROM native_projects WHERE id = {0} AND org_id = {1}
                UNION ALL
                SELECT p.id
                FROM native_projects p
                JOIN tree t ON p.parent_project_id = t.id
                WHERE p.org_id = {1}
            )
            SELECT id FROM tree;
        ";
        var rows = await db.Database.SqlQueryRaw<Guid>(sql, rootProjectId, orgId).ToListAsync(ct);
        return rows;
    }
}
