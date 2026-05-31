using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <summary>
    /// Adds the cadence-aware shape to invoice_lines:
    ///
    ///   * quantity      numeric(10,4)  — canonical "how many units"
    ///   * quantity_unit varchar(16)    — 'hours' | 'days' | 'months'
    ///   * cadence       varchar(16)    — 'hourly' | 'daily' | 'monthly'
    ///
    /// Plus a sidecar mapping table for ROLLUP lines (daily / monthly), which
    /// aggregate N worklogs into a single line so the existing scalar
    /// invoice_lines.worklog_id cannot represent the relationship:
    ///
    ///   invoice_line_worklogs (
    ///     invoice_line_id uuid NOT NULL REFERENCES invoice_lines(id) ON DELETE CASCADE,
    ///     worklog_id      uuid NOT NULL REFERENCES worklogs(id)      ON DELETE CASCADE,
    ///     PRIMARY KEY (invoice_line_id, worklog_id)
    ///   )
    ///
    /// Per CLAUDE.md's "NOT NULL on populated columns is a multi-step ceremony":
    /// this migration ADDS the three columns NULLABLE and runs an idempotent
    /// backfill that flips every existing invoice_lines row to the hourly
    /// shape (quantity=hours, quantity_unit='hours', cadence='hourly'). A
    /// follow-up migration owes the SET NOT NULL + CHECK constraints once
    /// all envs have run this step.
    /// </summary>
    public partial class AddInvoiceLineCadence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ----- invoice_lines additive columns (nullable for the multi-step ceremony) -----
            migrationBuilder.AddColumn<decimal>(
                name: "quantity",
                table: "invoice_lines",
                type: "numeric(10,4)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "quantity_unit",
                table: "invoice_lines",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "cadence",
                table: "invoice_lines",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            // Idempotent backfill — flips every legacy line to hourly shape.
            // Safe to re-run: WHERE-guarded by NULL columns. Every historical
            // line was generated under the hourly cascade, so this is data-
            // accurate (no synthetic re-billing).
            migrationBuilder.Sql(@"
                UPDATE invoice_lines
                SET quantity      = COALESCE(quantity, hours),
                    quantity_unit = COALESCE(quantity_unit, 'hours'),
                    cadence       = COALESCE(cadence, 'hourly')
                WHERE quantity IS NULL
                   OR quantity_unit IS NULL
                   OR cadence IS NULL;
            ");

            // ----- sidecar: rollup line -> backing worklogs -----
            migrationBuilder.CreateTable(
                name: "invoice_line_worklogs",
                columns: table => new
                {
                    invoice_line_id = table.Column<Guid>(type: "uuid", nullable: false),
                    worklog_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_invoice_line_worklogs", x => new { x.invoice_line_id, x.worklog_id });
                    table.ForeignKey(
                        name: "fk_invoice_line_worklogs_invoice_line",
                        column: x => x.invoice_line_id,
                        principalTable: "invoice_lines",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_invoice_line_worklogs_worklog",
                        column: x => x.worklog_id,
                        principalTable: "worklogs",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_invoice_line_worklogs_line",
                table: "invoice_line_worklogs",
                column: "invoice_line_id");

            // UNIQUE on worklog_id: a worklog can only ever be rolled into
            // ONE invoice line. Mirrors the hourly invariant (worklog.invoice_line_id
            // is also single-valued).
            migrationBuilder.CreateIndex(
                name: "ix_invoice_line_worklogs_worklog_unique",
                table: "invoice_line_worklogs",
                column: "worklog_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "invoice_line_worklogs");

            migrationBuilder.DropColumn(
                name: "cadence",
                table: "invoice_lines");

            migrationBuilder.DropColumn(
                name: "quantity",
                table: "invoice_lines");

            migrationBuilder.DropColumn(
                name: "quantity_unit",
                table: "invoice_lines");
        }
    }
}
