using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <inheritdoc />
    public partial class TightenUserFkCascades : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_organisations_users_owner_id",
                table: "organisations");

            migrationBuilder.AlterColumn<Guid>(
                name: "owner_id",
                table: "organisations",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.CreateIndex(
                name: "IX_project_members_allocated_by",
                table: "project_members",
                column: "allocated_by");

            migrationBuilder.CreateIndex(
                name: "IX_native_tasks_assignee_id",
                table: "native_tasks",
                column: "assignee_id");

            migrationBuilder.CreateIndex(
                name: "IX_native_tasks_created_by",
                table: "native_tasks",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_native_projects_created_by",
                table: "native_projects",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_invoices_created_by",
                table: "invoices",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_integration_sync_jobs_started_by",
                table: "integration_sync_jobs",
                column: "started_by");

            migrationBuilder.CreateIndex(
                name: "IX_integration_connections_created_by",
                table: "integration_connections",
                column: "created_by");

            migrationBuilder.CreateIndex(
                name: "IX_clients_created_by",
                table: "clients",
                column: "created_by");

            migrationBuilder.AddForeignKey(
                name: "FK_audit_log_users_actor_id",
                table: "audit_log",
                column: "actor_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_clients_users_created_by",
                table: "clients",
                column: "created_by",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_integration_connections_users_created_by",
                table: "integration_connections",
                column: "created_by",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_integration_sync_jobs_users_started_by",
                table: "integration_sync_jobs",
                column: "started_by",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_invoices_users_created_by",
                table: "invoices",
                column: "created_by",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_native_projects_users_created_by",
                table: "native_projects",
                column: "created_by",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_native_tasks_users_assignee_id",
                table: "native_tasks",
                column: "assignee_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_native_tasks_users_created_by",
                table: "native_tasks",
                column: "created_by",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_organisations_users_owner_id",
                table: "organisations",
                column: "owner_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_project_members_users_allocated_by",
                table: "project_members",
                column: "allocated_by",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_audit_log_users_actor_id",
                table: "audit_log");

            migrationBuilder.DropForeignKey(
                name: "FK_clients_users_created_by",
                table: "clients");

            migrationBuilder.DropForeignKey(
                name: "FK_integration_connections_users_created_by",
                table: "integration_connections");

            migrationBuilder.DropForeignKey(
                name: "FK_integration_sync_jobs_users_started_by",
                table: "integration_sync_jobs");

            migrationBuilder.DropForeignKey(
                name: "FK_invoices_users_created_by",
                table: "invoices");

            migrationBuilder.DropForeignKey(
                name: "FK_native_projects_users_created_by",
                table: "native_projects");

            migrationBuilder.DropForeignKey(
                name: "FK_native_tasks_users_assignee_id",
                table: "native_tasks");

            migrationBuilder.DropForeignKey(
                name: "FK_native_tasks_users_created_by",
                table: "native_tasks");

            migrationBuilder.DropForeignKey(
                name: "FK_organisations_users_owner_id",
                table: "organisations");

            migrationBuilder.DropForeignKey(
                name: "FK_project_members_users_allocated_by",
                table: "project_members");

            migrationBuilder.DropIndex(
                name: "IX_project_members_allocated_by",
                table: "project_members");

            migrationBuilder.DropIndex(
                name: "IX_native_tasks_assignee_id",
                table: "native_tasks");

            migrationBuilder.DropIndex(
                name: "IX_native_tasks_created_by",
                table: "native_tasks");

            migrationBuilder.DropIndex(
                name: "IX_native_projects_created_by",
                table: "native_projects");

            migrationBuilder.DropIndex(
                name: "IX_invoices_created_by",
                table: "invoices");

            migrationBuilder.DropIndex(
                name: "IX_integration_sync_jobs_started_by",
                table: "integration_sync_jobs");

            migrationBuilder.DropIndex(
                name: "IX_integration_connections_created_by",
                table: "integration_connections");

            migrationBuilder.DropIndex(
                name: "IX_clients_created_by",
                table: "clients");

            migrationBuilder.AlterColumn<Guid>(
                name: "owner_id",
                table: "organisations",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_organisations_users_owner_id",
                table: "organisations",
                column: "owner_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
