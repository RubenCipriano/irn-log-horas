using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TimeFlow.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddMemberCostAndProjectAllocations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "cost_per_hour",
                table: "org_memberships",
                type: "numeric(10,2)",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "project_members",
                columns: table => new
                {
                    project_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    org_id = table.Column<Guid>(type: "uuid", nullable: false),
                    cost_per_hour = table.Column<decimal>(type: "numeric(10,2)", nullable: true),
                    allocated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    allocated_by = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_members", x => new { x.project_id, x.user_id });
                    table.ForeignKey(
                        name: "FK_project_members_native_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "native_projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_project_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_project_members_org",
                table: "project_members",
                column: "org_id");

            migrationBuilder.CreateIndex(
                name: "ix_project_members_user_project",
                table: "project_members",
                columns: new[] { "user_id", "project_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "project_members");

            migrationBuilder.DropColumn(
                name: "cost_per_hour",
                table: "org_memberships");
        }
    }
}
