using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <inheritdoc />
    public partial class UnifiedProjectsAndPush : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Guid>(
                name: "project_id",
                table: "worklogs",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "push_error_code",
                table: "worklogs",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "push_status",
                table: "worklogs",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "upstream_task_id",
                table: "worklogs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "upstream_worklog_id",
                table: "worklogs",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "upstream_projects",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    connection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    org_id = table.Column<Guid>(type: "uuid", nullable: false),
                    upstream_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    code = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    archived = table.Column<bool>(type: "boolean", nullable: false),
                    last_synced_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
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

            migrationBuilder.CreateIndex(
                name: "ix_worklogs_push_status",
                table: "worklogs",
                column: "push_status");

            migrationBuilder.CreateIndex(
                name: "IX_worklogs_upstream_task_id",
                table: "worklogs",
                column: "upstream_task_id");

            migrationBuilder.CreateIndex(
                name: "ix_upstream_projects_conn_upstream_unique",
                table: "upstream_projects",
                columns: new[] { "connection_id", "upstream_id" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_worklogs_upstream_tasks_upstream_task_id",
                table: "worklogs",
                column: "upstream_task_id",
                principalTable: "upstream_tasks",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_worklogs_upstream_tasks_upstream_task_id",
                table: "worklogs");

            migrationBuilder.DropTable(
                name: "upstream_projects");

            migrationBuilder.DropIndex(
                name: "ix_worklogs_push_status",
                table: "worklogs");

            migrationBuilder.DropIndex(
                name: "IX_worklogs_upstream_task_id",
                table: "worklogs");

            migrationBuilder.DropColumn(
                name: "push_error_code",
                table: "worklogs");

            migrationBuilder.DropColumn(
                name: "push_status",
                table: "worklogs");

            migrationBuilder.DropColumn(
                name: "upstream_task_id",
                table: "worklogs");

            migrationBuilder.DropColumn(
                name: "upstream_worklog_id",
                table: "worklogs");

            migrationBuilder.AlterColumn<Guid>(
                name: "project_id",
                table: "worklogs",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
