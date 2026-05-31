using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <summary>
    /// Re-architecture: drop the Clients entity (absorbed into NativeProject)
    /// and re-key IntegrationConnection from (Client) onto (Project, User,
    /// Provider) tuples.
    ///
    /// The user picked "wipe + restart fresh" so this migration:
    ///   1. Deletes every mirrored sub-project + task (their connection_id
    ///      will become invalid once the FK gets repointed).
    ///   2. Deletes every integration_connections row (the new schema
    ///      requires a project_id + user_id pair that the legacy client-
    ///      scoped row can't supply).
    ///   3. Copies the per-client billing fields onto any native_project
    ///      that linked to a client, then drops the clients table.
    ///   4. Repoints invoices.client_id → invoices.project_id, taking the
    ///      first project that ever linked to each client. Invoices that
    ///      can't be mapped are deleted (user noted zero non-void invoices
    ///      in dev — losing the others is acceptable).
    ///
    /// Worklogs survive: they reference project_id directly, not the
    /// mirror sub-projects we delete in step 1.
    /// </summary>
    public partial class CollapseClientsIntoProjects : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // --- 1. Pre-flight wipes (data the user opted to discard) ---
            // Mirrored sub-projects + tasks. Their connection_id will be
            // invalid once we drop the rows below. Worklogs survive (they
            // hang off project_id pointing at the engagement).
            migrationBuilder.Sql("DELETE FROM native_tasks WHERE connection_id IS NOT NULL;");
            migrationBuilder.Sql("DELETE FROM native_projects WHERE connection_id IS NOT NULL;");
            // Drop every connection — none of them has a project_id/user_id
            // pair yet, and the user's flow has them re-add fresh under the
            // new shape (per-member integration on the engagement project).
            migrationBuilder.Sql("DELETE FROM integration_connections;");

            // --- 2. Repoint invoices BEFORE dropping clients ---
            // Add the new column, copy a best-guess project_id (any project
            // that was linked to the client; deterministic by created_at),
            // then delete any invoice we couldn't map.
            migrationBuilder.AddColumn<Guid>(
                name: "project_id",
                table: "invoices",
                type: "uuid",
                nullable: true);
            migrationBuilder.Sql(@"
                UPDATE invoices i SET project_id = (
                    SELECT p.id FROM native_projects p
                     WHERE p.client_id = i.client_id
                     ORDER BY p.created_at ASC
                     LIMIT 1
                );
            ");
            // Drop unmappable invoices + their lines (the user noted zero
            // non-void invoices in dev; in prod the operator runs a one-off
            // backfill before applying this migration).
            migrationBuilder.Sql(@"
                DELETE FROM invoice_lines WHERE invoice_id IN (
                    SELECT id FROM invoices WHERE project_id IS NULL
                );
                DELETE FROM invoices WHERE project_id IS NULL;
            ");

            // --- 3. Copy client billing fields onto the project ---
            // Additive columns first so we can populate them from clients.
            migrationBuilder.AddColumn<string>(
                name: "address",
                table: "native_projects",
                type: "text",
                nullable: true);
            migrationBuilder.AddColumn<string>(
                name: "contact_email",
                table: "native_projects",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
            migrationBuilder.AddColumn<string>(
                name: "contact_name",
                table: "native_projects",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
            migrationBuilder.AddColumn<decimal>(
                name: "default_bill_rate",
                table: "native_projects",
                type: "numeric(10,2)",
                nullable: true);
            migrationBuilder.AddColumn<string>(
                name: "tax_id",
                table: "native_projects",
                type: "character varying(60)",
                maxLength: 60,
                nullable: true);
            migrationBuilder.Sql(@"
                UPDATE native_projects p SET
                    contact_email     = c.contact_email,
                    contact_name      = c.contact_name,
                    tax_id            = c.tax_id,
                    address           = c.address,
                    default_bill_rate = c.default_bill_rate
                FROM clients c
                WHERE p.client_id = c.id;
            ");

            // --- 4. invoices.billed_party_name snapshot column ---
            migrationBuilder.AddColumn<string>(
                name: "billed_party_name",
                table: "invoices",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);
            // Backfill from the project's name for the surviving invoices
            // so historical rendering keeps the original display.
            migrationBuilder.Sql(@"
                UPDATE invoices i SET billed_party_name = p.name
                FROM native_projects p
                WHERE i.project_id = p.id AND i.billed_party_name IS NULL;
            ");

            // --- 5. Drop FKs that pinned things to clients ---
            migrationBuilder.DropForeignKey(
                name: "FK_integration_connections_clients_client_id",
                table: "integration_connections");
            migrationBuilder.DropForeignKey(
                name: "FK_invoices_clients_client_id",
                table: "invoices");
            migrationBuilder.DropForeignKey(
                name: "FK_native_projects_clients_client_id",
                table: "native_projects");

            // --- 6. Drop legacy indexes + columns + the clients table ---
            migrationBuilder.DropIndex(
                name: "ix_native_projects_client",
                table: "native_projects");
            migrationBuilder.DropIndex(
                name: "ix_integration_connections_client_unique",
                table: "integration_connections");
            migrationBuilder.DropColumn(
                name: "client_id",
                table: "native_projects");
            migrationBuilder.DropColumn(
                name: "client_id",
                table: "invoices");
            migrationBuilder.DropColumn(
                name: "client_id",
                table: "integration_connections");
            migrationBuilder.DropTable(
                name: "clients");

            // --- 7. invoices.project_id becomes NOT NULL + indexed ---
            migrationBuilder.AlterColumn<Guid>(
                name: "project_id",
                table: "invoices",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
            migrationBuilder.CreateIndex(
                name: "IX_invoices_project_id",
                table: "invoices",
                column: "project_id");
            migrationBuilder.CreateIndex(
                name: "ix_invoices_org_project",
                table: "invoices",
                columns: new[] { "org_id", "project_id" });
            migrationBuilder.AddForeignKey(
                name: "FK_invoices_native_projects_project_id",
                table: "invoices",
                column: "project_id",
                principalTable: "native_projects",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            // --- 8. integration_connections (project_id, user_id) tuple ---
            migrationBuilder.AddColumn<Guid>(
                name: "project_id",
                table: "integration_connections",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));
            migrationBuilder.AddColumn<Guid>(
                name: "user_id",
                table: "integration_connections",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));
            // Defaults above never trigger — the DELETE FROM in step 1
            // guarantees zero existing rows. They exist solely to satisfy
            // Npgsql's NOT NULL DDL.
            migrationBuilder.CreateIndex(
                name: "ix_integration_connections_project_user_provider_unique",
                table: "integration_connections",
                columns: new[] { "project_id", "user_id", "provider" },
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_integration_connections_user_id",
                table: "integration_connections",
                column: "user_id");
            migrationBuilder.AddForeignKey(
                name: "FK_integration_connections_native_projects_project_id",
                table: "integration_connections",
                column: "project_id",
                principalTable: "native_projects",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
            migrationBuilder.AddForeignKey(
                name: "FK_integration_connections_users_user_id",
                table: "integration_connections",
                column: "user_id",
                principalTable: "users",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Best-effort restore — data loss accepted on the way down too.
            migrationBuilder.DropForeignKey(
                name: "FK_integration_connections_native_projects_project_id",
                table: "integration_connections");
            migrationBuilder.DropForeignKey(
                name: "FK_integration_connections_users_user_id",
                table: "integration_connections");
            migrationBuilder.DropForeignKey(
                name: "FK_invoices_native_projects_project_id",
                table: "invoices");

            migrationBuilder.DropIndex(
                name: "ix_integration_connections_project_user_provider_unique",
                table: "integration_connections");
            migrationBuilder.DropIndex(
                name: "IX_integration_connections_user_id",
                table: "integration_connections");
            migrationBuilder.DropIndex(
                name: "IX_invoices_project_id",
                table: "invoices");
            migrationBuilder.DropIndex(
                name: "ix_invoices_org_project",
                table: "invoices");

            migrationBuilder.DropColumn(name: "project_id", table: "integration_connections");
            migrationBuilder.DropColumn(name: "user_id", table: "integration_connections");
            migrationBuilder.DropColumn(name: "project_id", table: "invoices");
            migrationBuilder.DropColumn(name: "billed_party_name", table: "invoices");
            migrationBuilder.DropColumn(name: "address", table: "native_projects");
            migrationBuilder.DropColumn(name: "contact_email", table: "native_projects");
            migrationBuilder.DropColumn(name: "contact_name", table: "native_projects");
            migrationBuilder.DropColumn(name: "default_bill_rate", table: "native_projects");
            migrationBuilder.DropColumn(name: "tax_id", table: "native_projects");

            migrationBuilder.CreateTable(
                name: "clients",
                columns: table => new {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    org_id = table.Column<Guid>(type: "uuid", nullable: false),
                    address = table.Column<string>(type: "text", nullable: true),
                    archived = table.Column<bool>(type: "boolean", nullable: false),
                    contact_email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    contact_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    default_bill_rate = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    tax_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table => {
                    table.PrimaryKey("PK_clients", x => x.id);
                    table.ForeignKey(
                        name: "FK_clients_organisations_org_id",
                        column: x => x.org_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_clients_users_created_by",
                        column: x => x.created_by,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.AddColumn<Guid>(
                name: "client_id",
                table: "native_projects",
                type: "uuid",
                nullable: true);
            migrationBuilder.AddColumn<Guid>(
                name: "client_id",
                table: "invoices",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));
            migrationBuilder.AddColumn<Guid>(
                name: "client_id",
                table: "integration_connections",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateIndex(
                name: "ix_native_projects_client",
                table: "native_projects",
                column: "client_id");
            migrationBuilder.CreateIndex(
                name: "ix_integration_connections_client_unique",
                table: "integration_connections",
                column: "client_id",
                unique: true);
            migrationBuilder.CreateIndex(
                name: "IX_clients_created_by",
                table: "clients",
                column: "created_by");
            migrationBuilder.CreateIndex(
                name: "ix_clients_org_archived",
                table: "clients",
                columns: new[] { "org_id", "archived" });
            migrationBuilder.CreateIndex(
                name: "ix_clients_org_name_unique",
                table: "clients",
                columns: new[] { "org_id", "name" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_integration_connections_clients_client_id",
                table: "integration_connections",
                column: "client_id",
                principalTable: "clients",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(
                name: "FK_invoices_clients_client_id",
                table: "invoices",
                column: "client_id",
                principalTable: "clients",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
            migrationBuilder.AddForeignKey(
                name: "FK_native_projects_clients_client_id",
                table: "native_projects",
                column: "client_id",
                principalTable: "clients",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }
    }
}
