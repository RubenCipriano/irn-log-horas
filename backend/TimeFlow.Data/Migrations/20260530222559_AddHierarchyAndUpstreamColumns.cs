using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddHierarchyAndUpstreamColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "denied",
                table: "project_members",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "role_on_project",
                table: "project_members",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                defaultValue: "developer");

            migrationBuilder.AddColumn<string>(
                name: "assignee_upstream_id",
                table: "native_tasks",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "connection_id",
                table: "native_tasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "upstream_raw_json",
                table: "native_tasks",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "upstream_task_id",
                table: "native_tasks",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "upstream_updated_at",
                table: "native_tasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "upstream_version_id",
                table: "native_tasks",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "upstream_version_name",
                table: "native_tasks",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "connection_id",
                table: "native_projects",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "last_synced_at",
                table: "native_projects",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "parent_project_id",
                table: "native_projects",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "type",
                table: "native_projects",
                type: "character varying(40)",
                maxLength: 40,
                nullable: false,
                defaultValue: "project");

            migrationBuilder.AddColumn<string>(
                name: "upstream_project_id",
                table: "native_projects",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "upstream_raw_json",
                table: "native_projects",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "upstream_updated_at",
                table: "native_projects",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "client_id",
                table: "integration_connections",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_native_tasks_connection_upstream_unique",
                table: "native_tasks",
                columns: new[] { "connection_id", "upstream_task_id" },
                unique: true,
                filter: "connection_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_native_projects_connection_upstream_unique",
                table: "native_projects",
                columns: new[] { "connection_id", "upstream_project_id" },
                unique: true,
                filter: "connection_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_native_projects_org_parent",
                table: "native_projects",
                columns: new[] { "org_id", "parent_project_id" });

            migrationBuilder.CreateIndex(
                name: "IX_native_projects_parent_project_id",
                table: "native_projects",
                column: "parent_project_id");

            migrationBuilder.CreateIndex(
                name: "ix_integration_connections_client_unique",
                table: "integration_connections",
                column: "client_id",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_integration_connections_clients_client_id",
                table: "integration_connections",
                column: "client_id",
                principalTable: "clients",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_native_projects_integration_connections_connection_id",
                table: "native_projects",
                column: "connection_id",
                principalTable: "integration_connections",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_native_projects_native_projects_parent_project_id",
                table: "native_projects",
                column: "parent_project_id",
                principalTable: "native_projects",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_native_tasks_integration_connections_connection_id",
                table: "native_tasks",
                column: "connection_id",
                principalTable: "integration_connections",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_integration_connections_clients_client_id",
                table: "integration_connections");

            migrationBuilder.DropForeignKey(
                name: "FK_native_projects_integration_connections_connection_id",
                table: "native_projects");

            migrationBuilder.DropForeignKey(
                name: "FK_native_projects_native_projects_parent_project_id",
                table: "native_projects");

            migrationBuilder.DropForeignKey(
                name: "FK_native_tasks_integration_connections_connection_id",
                table: "native_tasks");

            migrationBuilder.DropIndex(
                name: "ix_native_tasks_connection_upstream_unique",
                table: "native_tasks");

            migrationBuilder.DropIndex(
                name: "ix_native_projects_connection_upstream_unique",
                table: "native_projects");

            migrationBuilder.DropIndex(
                name: "ix_native_projects_org_parent",
                table: "native_projects");

            migrationBuilder.DropIndex(
                name: "IX_native_projects_parent_project_id",
                table: "native_projects");

            migrationBuilder.DropIndex(
                name: "ix_integration_connections_client_unique",
                table: "integration_connections");

            migrationBuilder.DropColumn(
                name: "denied",
                table: "project_members");

            migrationBuilder.DropColumn(
                name: "role_on_project",
                table: "project_members");

            migrationBuilder.DropColumn(
                name: "assignee_upstream_id",
                table: "native_tasks");

            migrationBuilder.DropColumn(
                name: "connection_id",
                table: "native_tasks");

            migrationBuilder.DropColumn(
                name: "upstream_raw_json",
                table: "native_tasks");

            migrationBuilder.DropColumn(
                name: "upstream_task_id",
                table: "native_tasks");

            migrationBuilder.DropColumn(
                name: "upstream_updated_at",
                table: "native_tasks");

            migrationBuilder.DropColumn(
                name: "upstream_version_id",
                table: "native_tasks");

            migrationBuilder.DropColumn(
                name: "upstream_version_name",
                table: "native_tasks");

            migrationBuilder.DropColumn(
                name: "connection_id",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "last_synced_at",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "parent_project_id",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "type",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "upstream_project_id",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "upstream_raw_json",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "upstream_updated_at",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "client_id",
                table: "integration_connections");
        }
    }
}
