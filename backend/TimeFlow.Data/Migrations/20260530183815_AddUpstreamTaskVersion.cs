using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddUpstreamTaskVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "upstream_version_id",
                table: "upstream_tasks",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "upstream_version_name",
                table: "upstream_tasks",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_upstream_tasks_conn_version",
                table: "upstream_tasks",
                columns: new[] { "connection_id", "upstream_version_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_upstream_tasks_conn_version",
                table: "upstream_tasks");

            migrationBuilder.DropColumn(
                name: "upstream_version_id",
                table: "upstream_tasks");

            migrationBuilder.DropColumn(
                name: "upstream_version_name",
                table: "upstream_tasks");
        }
    }
}
