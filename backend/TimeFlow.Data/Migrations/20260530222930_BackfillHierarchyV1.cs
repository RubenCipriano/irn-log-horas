using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <summary>
    /// Phase B of the spec — one-time data backfill. Moves data from the
    /// soon-to-be-dropped tables (`upstream_projects`, `upstream_tasks`,
    /// `client_upstream_projects`, `squads`, `squad_members`) into the
    /// new hierarchy-aware `native_projects` + `native_tasks` + `clients`
    /// + `project_members` shapes. Idempotent: `WHERE NOT EXISTS` / ON
    /// CONFLICT guards so re-running won't duplicate rows.
    ///
    /// The downstream Phase C/D PRs will then switch endpoint reads off
    /// the old tables and finally DROP them. This migration keeps both
    /// shapes valid simultaneously so existing endpoints keep working.
    /// </summary>
    public partial class BackfillHierarchyV1 : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. upstream_projects -> native_projects rows.
            //    Each upstream project becomes a root native project carrying
            //    the (connection_id, upstream_project_id) mirror tuple. The
            //    UNIQUE partial index added in Phase A guards against dup
            //    inserts even if this migration somehow runs twice.
            migrationBuilder.Sql(@"
                INSERT INTO native_projects (
                    id, org_id, name, code, archived, type,
                    connection_id, upstream_project_id, last_synced_at,
                    created_at, updated_at
                )
                SELECT
                    gen_random_uuid(),
                    up.org_id,
                    -- Width-safe casts: upstream columns are wider than
                    -- their native_projects counterparts. Truncate during
                    -- the backfill instead of altering existing columns.
                    LEFT(up.name, 160),
                    LEFT(up.code, 40),
                    up.archived,
                    'project',
                    up.connection_id,
                    up.upstream_id,
                    up.last_synced_at,
                    NOW(),
                    NOW()
                FROM upstream_projects up
                WHERE NOT EXISTS (
                    SELECT 1 FROM native_projects np
                    WHERE np.connection_id = up.connection_id
                      AND np.upstream_project_id = up.upstream_id
                );
            ");

            // 2. upstream_tasks -> native_tasks rows. The parent project is
            //    the freshly-created native_projects row (looked up via the
            //    same (connection_id, upstream_project_id) tuple).
            migrationBuilder.Sql(@"
                INSERT INTO native_tasks (
                    id, project_id, org_id, title, status,
                    connection_id, upstream_task_id,
                    upstream_version_id, upstream_version_name,
                    upstream_updated_at, assignee_upstream_id, upstream_raw_json,
                    created_at, updated_at
                )
                SELECT
                    gen_random_uuid(),
                    np.id,
                    ut.org_id,
                    -- native_tasks.title is varchar(200); upstream tasks
                    -- run wider (varchar(400)). Truncate during the
                    -- backfill rather than alter the existing column.
                    LEFT(ut.title, 200),
                    COALESCE(ut.status, 'open'),
                    ut.connection_id,
                    ut.upstream_id,
                    ut.upstream_version_id,
                    ut.upstream_version_name,
                    ut.upstream_updated_at,
                    ut.assignee_upstream_id,
                    ut.raw,
                    NOW(),
                    NOW()
                FROM upstream_tasks ut
                JOIN native_projects np
                  ON np.connection_id = ut.connection_id
                 AND np.upstream_project_id = ut.upstream_project_id
                WHERE NOT EXISTS (
                    SELECT 1 FROM native_tasks nt
                    WHERE nt.connection_id = ut.connection_id
                      AND nt.upstream_task_id = ut.upstream_id
                );
            ");

            // 3. client_upstream_projects -> native_projects.client_id.
            //    The mirrored root project inherits the client_id link.
            migrationBuilder.Sql(@"
                UPDATE native_projects np
                SET client_id = cup.client_id
                FROM client_upstream_projects cup
                WHERE np.connection_id = cup.connection_id
                  AND np.upstream_project_id = cup.upstream_project_id
                  AND np.client_id IS NULL;
            ");

            // 4. integration_connections.client_id backfill.
            //    Take the most-referenced client across each connection's
            //    client_upstream_projects rows. Ties are broken by
            //    client_id sort order (deterministic).
            migrationBuilder.Sql(@"
                WITH ranked AS (
                    SELECT
                        cup.connection_id,
                        cup.client_id,
                        COUNT(*) AS ref_count,
                        ROW_NUMBER() OVER (
                            PARTITION BY cup.connection_id
                            ORDER BY COUNT(*) DESC, cup.client_id
                        ) AS rk
                    FROM client_upstream_projects cup
                    GROUP BY cup.connection_id, cup.client_id
                )
                UPDATE integration_connections ic
                SET client_id = ranked.client_id
                FROM ranked
                WHERE ic.id = ranked.connection_id
                  AND ic.client_id IS NULL
                  AND ranked.rk = 1;
            ");

            // 4b. Connections still WITHOUT a client_id get a synthetic
            //     client per spec G2.
            //
            //     Correlation strategy: we add a temporary surrogate column
            //     `auto_for_connection_id` (uuid) to `clients` so the INSERT
            //     and the follow-up UPDATE share a stable join key — the
            //     connection's own id — instead of a round-tripped, truncated
            //     display string. The name column is still populated for the
            //     UI, but it is NOT used as a join key. This eliminates the
            //     failure mode where a name containing a quote, apostrophe, or
            //     a multibyte char at the 200-char truncation boundary causes
            //     a mismatch and leaves client_id NULL.
            //
            //     The surrogate column is dropped in DropLegacyHierarchyTables
            //     (Phase D) once it is no longer needed. It is never mapped
            //     by EF or the Client model — it is a pure backfill artifact.
            migrationBuilder.Sql(@"
                ALTER TABLE clients
                    ADD COLUMN IF NOT EXISTS auto_for_connection_id uuid;
            ");

            migrationBuilder.Sql(@"
                INSERT INTO clients (
                    id, org_id, name, archived, created_at, updated_at,
                    auto_for_connection_id
                )
                SELECT
                    gen_random_uuid(),
                    ic.org_id,
                    LEFT('Auto: ' || ic.name || ' (' || SUBSTRING(ic.id::text, 1, 8) || ')', 200),
                    false,
                    NOW(),
                    NOW(),
                    ic.id
                FROM integration_connections ic
                WHERE ic.client_id IS NULL
                ON CONFLICT DO NOTHING;
            ");

            migrationBuilder.Sql(@"
                UPDATE integration_connections ic
                SET client_id = c.id
                FROM clients c
                WHERE ic.client_id IS NULL
                  AND c.auto_for_connection_id = ic.id;
            ");

            // 4c. Mirrored root projects whose client_id is still NULL
            //     (connections that had no upstream link rows) inherit
            //     their connection's now-set client.
            migrationBuilder.Sql(@"
                UPDATE native_projects np
                SET client_id = ic.client_id
                FROM integration_connections ic
                WHERE np.connection_id = ic.id
                  AND np.client_id IS NULL
                  AND ic.client_id IS NOT NULL;
            ");

            // 5. squads -> native_projects (type='team'). Reuse the squad's
            //    own id as the project id so the (squad_members ->
            //    project_members) follow-up join is a single FK match.
            migrationBuilder.Sql(@"
                INSERT INTO native_projects (
                    id, org_id, name, archived, type,
                    created_by, created_at, updated_at
                )
                SELECT
                    s.id,
                    s.org_id,
                    s.name,
                    false,
                    'team',
                    s.created_by,
                    s.created_at,
                    s.updated_at
                FROM squads s
                ON CONFLICT (id) DO NOTHING;
            ");

            // 5b. squad_members -> project_members. Manager becomes
            //     role_on_project='manager'; everyone else 'developer'.
            //     Idempotent via (project_id, user_id) PK.
            migrationBuilder.Sql(@"
                INSERT INTO project_members (
                    project_id, user_id, org_id, role_on_project, denied,
                    allocated_at
                )
                SELECT
                    s.id,
                    sm.user_id,
                    s.org_id,
                    CASE WHEN sm.user_id = s.manager_id THEN 'manager' ELSE 'developer' END,
                    false,
                    s.created_at
                FROM squad_members sm
                JOIN squads s ON s.id = sm.squad_id
                ON CONFLICT (project_id, user_id) DO NOTHING;
            ");

            // 6. Worklog remap — upstream_task_id (UUID FK) -> task_id +
            //    project_id (the new native task lineage). Only touches
            //    rows whose task_id is still NULL so re-runs are safe.
            //    Billed worklogs (invoice_line_id != NULL) ARE remapped
            //    too; their invoice line's frozen `bill_rate` is on the
            //    InvoiceLine row and isn't recomputed by this update.
            migrationBuilder.Sql(@"
                UPDATE worklogs w
                SET
                    task_id    = nt.id,
                    project_id = nt.project_id
                FROM upstream_tasks ut
                JOIN native_tasks nt
                  ON nt.connection_id     = ut.connection_id
                 AND nt.upstream_task_id  = ut.upstream_id
                WHERE w.upstream_task_id = ut.id
                  AND w.task_id IS NULL;
            ");
        }

        /// <summary>
        /// Down: best-effort reversal — delete the synthesised rows that
        /// can be identified (via the mirror tuple / squad-id reuse).
        /// We do NOT delete clients or unwind worklog remaps because that
        /// would lose data; if rollback is needed, restore from backup.
        /// </summary>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                DELETE FROM project_members pm
                WHERE EXISTS (
                    SELECT 1 FROM squads s
                    WHERE s.id = pm.project_id
                );
            ");
            migrationBuilder.Sql(@"
                DELETE FROM native_projects np
                WHERE np.type = 'team'
                  AND EXISTS (
                      SELECT 1 FROM squads s WHERE s.id = np.id
                  );
            ");
            migrationBuilder.Sql(@"
                DELETE FROM native_tasks nt
                WHERE nt.connection_id IS NOT NULL
                  AND nt.upstream_task_id IS NOT NULL;
            ");
            migrationBuilder.Sql(@"
                DELETE FROM native_projects np
                WHERE np.connection_id IS NOT NULL
                  AND np.upstream_project_id IS NOT NULL;
            ");
            migrationBuilder.Sql(@"
                UPDATE integration_connections SET client_id = NULL;
            ");

            // Drop the backfill-only correlation column so its lifecycle is
            // symmetric whether or not Phase D (which also drops it) has run.
            migrationBuilder.Sql(@"
                ALTER TABLE clients DROP COLUMN IF EXISTS auto_for_connection_id;
            ");
        }
    }
}
