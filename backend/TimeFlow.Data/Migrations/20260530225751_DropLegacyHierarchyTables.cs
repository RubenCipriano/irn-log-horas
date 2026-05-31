using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <summary>
    /// Phase D of the hierarchy refactor — destructive drops.
    ///
    /// Removes everything Phase C made unreachable:
    ///   * `upstream_projects` / `upstream_tasks` — absorbed into
    ///     `native_projects` / `native_tasks` via the (connection_id,
    ///     upstream_*) mirror tuples.
    ///   * `client_upstream_projects` — replaced by direct mirroring
    ///     (each upstream sub-project IS a row in native_projects
    ///     carrying the inherited root client_id).
    ///   * `squads` / `squad_members` — squads became
    ///     `native_projects WHERE type='team'`; squad members became
    ///     `project_members` rows with the right `role_on_project`.
    ///   * `worklogs.upstream_task_id` — mirror tuple lives on
    ///     `native_tasks` now; worklogs always point at `task_id`.
    ///
    /// Promotes `integration_connections.client_id` to NOT NULL per
    /// spec §I8 (1 connection = 1 client). Phase B's backfill (step 4
    /// + 4b) already populated every row, including a synthetic client
    /// per unattached connection — so this alter is a no-op for data
    /// and a constraint tightening for the schema. A defensive assert
    /// runs first so we fail loudly if (somehow) Phase B left a NULL.
    /// </summary>
    public partial class DropLegacyHierarchyTables : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Defensive pre-flight: Phase B should have backfilled every
            // connection's client_id. If somehow a NULL slipped through,
            // raise loudly here rather than silently substituting a zero
            // Guid via EF's generated default.
            migrationBuilder.Sql(@"
                DO $$
                DECLARE
                    bad_count integer;
                BEGIN
                    SELECT COUNT(*) INTO bad_count
                    FROM integration_connections WHERE client_id IS NULL;
                    IF bad_count > 0 THEN
                        RAISE EXCEPTION
                            'Cannot promote integration_connections.client_id to NOT NULL: % rows still NULL. Run Phase B (BackfillHierarchyV1) first.',
                            bad_count;
                    END IF;
                END $$;
            ");

            migrationBuilder.DropForeignKey(
                name: "FK_worklogs_upstream_tasks_upstream_task_id",
                table: "worklogs");

            migrationBuilder.DropTable(
                name: "client_upstream_projects");

            migrationBuilder.DropTable(
                name: "squad_members");

            migrationBuilder.DropTable(
                name: "upstream_projects");

            migrationBuilder.DropTable(
                name: "upstream_tasks");

            migrationBuilder.DropTable(
                name: "squads");

            migrationBuilder.DropIndex(
                name: "IX_worklogs_upstream_task_id",
                table: "worklogs");

            migrationBuilder.DropColumn(
                name: "upstream_task_id",
                table: "worklogs");

            // Drop the Phase B correlation artifact. The `auto_for_connection_id`
            // column on `clients` was added by BackfillHierarchyV1 solely to
            // correlate the auto-client INSERT with its follow-up UPDATE using
            // a stable join key (connection.id) instead of a truncated name
            // string. It is not part of the Client model, not mapped by EF,
            // and not wanted in the final schema.
            migrationBuilder.Sql(@"
                ALTER TABLE clients DROP COLUMN IF EXISTS auto_for_connection_id;
            ");

            // No defaultValue — the assert above guarantees every row is
            // populated, so promoting to NOT NULL is purely a constraint
            // tightening. EF's generated default would mask a Phase B bug.
            migrationBuilder.AlterColumn<Guid>(
                name: "client_id",
                table: "integration_connections",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Restore the Phase B correlation column so BackfillHierarchyV1.Down
            // can run cleanly against the reverted schema.
            migrationBuilder.Sql(@"
                ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_for_connection_id uuid;
            ");

            migrationBuilder.AddColumn<Guid>(
                name: "upstream_task_id",
                table: "worklogs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "client_id",
                table: "integration_connections",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.CreateTable(
                name: "client_upstream_projects",
                columns: table => new
                {
                    client_id = table.Column<Guid>(type: "uuid", nullable: false),
                    connection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    upstream_project_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    linked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    linked_by = table.Column<Guid>(type: "uuid", nullable: true),
                    org_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_client_upstream_projects", x => new { x.client_id, x.connection_id, x.upstream_project_id });
                    table.ForeignKey(
                        name: "FK_client_upstream_projects_clients_client_id",
                        column: x => x.client_id,
                        principalTable: "clients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_client_upstream_projects_integration_connections_connection~",
                        column: x => x.connection_id,
                        principalTable: "integration_connections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "squads",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    manager_id = table.Column<Guid>(type: "uuid", nullable: true),
                    org_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_squads", x => x.id);
                    table.ForeignKey(
                        name: "FK_squads_organisations_org_id",
                        column: x => x.org_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_squads_users_manager_id",
                        column: x => x.manager_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "upstream_projects",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    archived = table.Column<bool>(type: "boolean", nullable: false),
                    code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    connection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    last_synced_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    org_id = table.Column<Guid>(type: "uuid", nullable: false),
                    upstream_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_upstream_projects", x => x.id);
                    table.ForeignKey(
                        name: "FK_upstream_projects_integration_connections_connection_id",
                        column: x => x.connection_id,
                        principalTable: "integration_connections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "upstream_tasks",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    assignee_upstream_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    connection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    last_synced_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    org_id = table.Column<Guid>(type: "uuid", nullable: false),
                    raw = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    title = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    upstream_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    upstream_project_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    upstream_updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    upstream_version_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    upstream_version_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_upstream_tasks", x => x.id);
                    table.ForeignKey(
                        name: "FK_upstream_tasks_integration_connections_connection_id",
                        column: x => x.connection_id,
                        principalTable: "integration_connections",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "squad_members",
                columns: table => new
                {
                    squad_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_squad_members", x => new { x.squad_id, x.user_id });
                    table.ForeignKey(
                        name: "FK_squad_members_squads_squad_id",
                        column: x => x.squad_id,
                        principalTable: "squads",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_squad_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_worklogs_upstream_task_id",
                table: "worklogs",
                column: "upstream_task_id");

            migrationBuilder.CreateIndex(
                name: "IX_client_upstream_projects_connection_id",
                table: "client_upstream_projects",
                column: "connection_id");

            migrationBuilder.CreateIndex(
                name: "ix_client_upstream_projects_org_conn_proj",
                table: "client_upstream_projects",
                columns: new[] { "org_id", "connection_id", "upstream_project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_squad_members_user_id",
                table: "squad_members",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "IX_squads_manager_id",
                table: "squads",
                column: "manager_id");

            migrationBuilder.CreateIndex(
                name: "ix_squads_org_id",
                table: "squads",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_upstream_projects_conn_upstream_unique",
                table: "upstream_projects",
                columns: new[] { "connection_id", "upstream_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_upstream_tasks_conn_project",
                table: "upstream_tasks",
                columns: new[] { "connection_id", "upstream_project_id" });

            migrationBuilder.CreateIndex(
                name: "ix_upstream_tasks_conn_upstream_unique",
                table: "upstream_tasks",
                columns: new[] { "connection_id", "upstream_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_upstream_tasks_conn_version",
                table: "upstream_tasks",
                columns: new[] { "connection_id", "upstream_version_id" });

            migrationBuilder.AddForeignKey(
                name: "FK_worklogs_upstream_tasks_upstream_task_id",
                table: "worklogs",
                column: "upstream_task_id",
                principalTable: "upstream_tasks",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
