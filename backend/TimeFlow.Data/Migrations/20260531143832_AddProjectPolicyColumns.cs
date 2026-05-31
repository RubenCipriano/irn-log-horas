using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <summary>
    /// Adds three nullable per-project policy columns to native_projects:
    ///
    ///   * schedule_config  (text)        — JSON OrgScheduleConfig override
    ///   * holiday_profile  (text)        — JSON OrgHolidayProfile override
    ///   * holiday_country  (varchar(2))  — ISO-3166-1 alpha-2 shortcut
    ///                                      (PT/ES/FR/IE/GB/US/...)
    ///
    /// NULL on any column is the legitimate "inherit" sentinel: the
    /// ProjectPolicyResolver walks parent_project_id up to the root and
    /// then falls back to organisations.schedule_config /
    /// organisations.holiday_profile / baked PT-IRN defaults.
    ///
    /// No backfill is performed — every existing native_projects row
    /// continues to resolve to the org-level policy exactly as it did
    /// before this migration. No new index is required either; ancestor
    /// walks reuse the existing ix_native_projects_org_parent and
    /// per-row reads go through the PK.
    /// </summary>
    public partial class AddProjectPolicyColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "holiday_country",
                table: "native_projects",
                type: "varchar(2)",
                maxLength: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "holiday_profile",
                table: "native_projects",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "schedule_config",
                table: "native_projects",
                type: "text",
                nullable: true);

            // Intentional: no backfill. NULL means "inherit from ancestor
            // or org policy"; every existing row keeps today's behaviour.
            migrationBuilder.Sql("-- intentional: no backfill, NULL means inherit");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "holiday_country",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "holiday_profile",
                table: "native_projects");

            migrationBuilder.DropColumn(
                name: "schedule_config",
                table: "native_projects");
        }
    }
}
