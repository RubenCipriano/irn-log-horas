using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBillingV1 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_worklogs_native_projects_project_id",
                table: "worklogs");

            migrationBuilder.AddColumn<Guid>(
                name: "invoice_line_id",
                table: "worklogs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_billable",
                table: "worklogs",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "currency",
                table: "organisations",
                type: "character varying(3)",
                maxLength: 3,
                nullable: false,
                defaultValue: "EUR");

            migrationBuilder.AddColumn<decimal>(
                name: "bill_rate",
                table: "native_projects",
                type: "numeric(10,2)",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "client_id",
                table: "native_projects",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "clients",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    org_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    contact_email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    contact_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    tax_id = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    address = table.Column<string>(type: "text", nullable: true),
                    default_bill_rate = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    archived = table.Column<bool>(type: "boolean", nullable: false),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_clients", x => x.id);
                    table.ForeignKey(
                        name: "FK_clients_organisations_org_id",
                        column: x => x.org_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "client_upstream_projects",
                columns: table => new
                {
                    client_id = table.Column<Guid>(type: "uuid", nullable: false),
                    connection_id = table.Column<Guid>(type: "uuid", nullable: false),
                    upstream_project_id = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    org_id = table.Column<Guid>(type: "uuid", nullable: false),
                    linked_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    linked_by = table.Column<Guid>(type: "uuid", nullable: true)
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
                name: "invoices",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    org_id = table.Column<Guid>(type: "uuid", nullable: false),
                    client_id = table.Column<Guid>(type: "uuid", nullable: false),
                    number = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    period_from = table.Column<DateOnly>(type: "date", nullable: false),
                    period_to = table.Column<DateOnly>(type: "date", nullable: false),
                    status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    subtotal = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    tax_pct = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    tax_amount = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    total = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    notes = table.Column<string>(type: "text", nullable: true),
                    issued_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    due_at = table.Column<DateOnly>(type: "date", nullable: true),
                    paid_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    created_by = table.Column<Guid>(type: "uuid", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_invoices", x => x.id);
                    table.ForeignKey(
                        name: "FK_invoices_clients_client_id",
                        column: x => x.client_id,
                        principalTable: "clients",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_invoices_organisations_org_id",
                        column: x => x.org_id,
                        principalTable: "organisations",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "invoice_lines",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    invoice_id = table.Column<Guid>(type: "uuid", nullable: false),
                    worklog_id = table.Column<Guid>(type: "uuid", nullable: true),
                    description = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    hours = table.Column<decimal>(type: "numeric(6,2)", nullable: false),
                    bill_rate = table.Column<decimal>(type: "numeric(10,2)", nullable: false),
                    amount = table.Column<decimal>(type: "numeric(12,2)", nullable: false),
                    ordinal = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_invoice_lines", x => x.id);
                    table.ForeignKey(
                        name: "FK_invoice_lines_invoices_invoice_id",
                        column: x => x.invoice_id,
                        principalTable: "invoices",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_invoice_lines_worklogs_worklog_id",
                        column: x => x.worklog_id,
                        principalTable: "worklogs",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_worklogs_invoice_line_id",
                table: "worklogs",
                column: "invoice_line_id");

            migrationBuilder.CreateIndex(
                name: "ix_native_projects_client",
                table: "native_projects",
                column: "client_id");

            migrationBuilder.CreateIndex(
                name: "IX_client_upstream_projects_connection_id",
                table: "client_upstream_projects",
                column: "connection_id");

            migrationBuilder.CreateIndex(
                name: "ix_client_upstream_projects_org_conn_proj",
                table: "client_upstream_projects",
                columns: new[] { "org_id", "connection_id", "upstream_project_id" });

            migrationBuilder.CreateIndex(
                name: "ix_clients_org_archived",
                table: "clients",
                columns: new[] { "org_id", "archived" });

            migrationBuilder.CreateIndex(
                name: "ix_clients_org_name_unique",
                table: "clients",
                columns: new[] { "org_id", "name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_invoice_lines_invoice_ordinal",
                table: "invoice_lines",
                columns: new[] { "invoice_id", "ordinal" });

            migrationBuilder.CreateIndex(
                name: "IX_invoice_lines_worklog_id",
                table: "invoice_lines",
                column: "worklog_id");

            migrationBuilder.CreateIndex(
                name: "IX_invoices_client_id",
                table: "invoices",
                column: "client_id");

            migrationBuilder.CreateIndex(
                name: "ix_invoices_org_client",
                table: "invoices",
                columns: new[] { "org_id", "client_id" });

            migrationBuilder.CreateIndex(
                name: "ix_invoices_org_number_unique",
                table: "invoices",
                columns: new[] { "org_id", "number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_invoices_org_status",
                table: "invoices",
                columns: new[] { "org_id", "status" });

            migrationBuilder.AddForeignKey(
                name: "FK_native_projects_clients_client_id",
                table: "native_projects",
                column: "client_id",
                principalTable: "clients",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_worklogs_invoice_lines_invoice_line_id",
                table: "worklogs",
                column: "invoice_line_id",
                principalTable: "invoice_lines",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_worklogs_native_projects_project_id",
                table: "worklogs",
                column: "project_id",
                principalTable: "native_projects",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_native_projects_clients_client_id",
                table: "native_projects");

            migrationBuilder.DropForeignKey(
                name: "FK_worklogs_invoice_lines_invoice_line_id",
                table: "worklogs");

            migrationBuilder.DropForeignKey(
                name: "FK_worklogs_native_projects_project_id",
                table: "worklogs");

            migrationBuilder.DropTable(
                name: "client_upstream_projects");

            migrationBuilder.DropTable(
                name: "invoice_lines");

            migrationBuilder.DropTable(
                name: "invoices");

            migrationBuilder.DropTable(
                name: "clients");

            migrationBuilder.DropIndex(
                name: "IX_worklogs_invoice_line_id",
                table: "worklogs");

            migrationBuilder.DropIndex(
                name: "ix_native_projects_client",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "invoice_line_id",
                table: "worklogs");

            migrationBuilder.DropColumn(
                name: "is_billable",
                table: "worklogs");

            migrationBuilder.DropColumn(
                name: "currency",
                table: "organisations");

            migrationBuilder.DropColumn(
                name: "bill_rate",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "client_id",
                table: "native_projects");

            migrationBuilder.AddForeignKey(
                name: "FK_worklogs_native_projects_project_id",
                table: "worklogs",
                column: "project_id",
                principalTable: "native_projects",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
