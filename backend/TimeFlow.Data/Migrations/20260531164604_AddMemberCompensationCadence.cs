using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <summary>
    /// Adds three nullable compensation-cadence columns to org_memberships:
    ///
    ///   * pay_cadence  (varchar(16)) — 'hourly' | 'daily' | 'monthly'
    ///   * daily_rate   (numeric(10,2))
    ///   * monthly_rate (numeric(10,2))
    ///
    /// Plus a CHECK constraint (ck_org_memberships_pay_cadence) that
    /// pins pay_cadence to the enum values (NULL still allowed).
    ///
    /// cost_per_hour stays as-is and continues to act as the "hourly" rate.
    ///
    /// No backfill is performed — NULL pay_cadence is the legitimate
    /// backwards-compat sentinel meaning "hourly". Every existing
    /// org_memberships row keeps today's paycheck math (Σ hours × cost_per_hour)
    /// without any data rewrite. Cadence-aware accumulators only kick in
    /// once an operator explicitly sets pay_cadence to 'daily' or 'monthly'.
    /// </summary>
    public partial class AddMemberCompensationCadence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "daily_rate",
                table: "org_memberships",
                type: "numeric(10,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "monthly_rate",
                table: "org_memberships",
                type: "numeric(10,2)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "pay_cadence",
                table: "org_memberships",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_org_memberships_pay_cadence",
                table: "org_memberships",
                sql: "pay_cadence IS NULL OR pay_cadence IN ('hourly','daily','monthly')");

            // Intentional: no backfill. NULL pay_cadence is the legitimate
            // "hourly" sentinel; every existing row remains valid and behaves
            // exactly as before until an operator opts into daily/monthly.
            migrationBuilder.Sql("-- intentional: no backfill, NULL pay_cadence means hourly");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_org_memberships_pay_cadence",
                table: "org_memberships");

            migrationBuilder.DropColumn(
                name: "daily_rate",
                table: "org_memberships");

            migrationBuilder.DropColumn(
                name: "monthly_rate",
                table: "org_memberships");

            migrationBuilder.DropColumn(
                name: "pay_cadence",
                table: "org_memberships");
        }
    }
}
