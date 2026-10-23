using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProtocoloApp.Api.Shared.Data.Migrations
{
    /// <inheritdoc />
    public partial class CheckinStressMood : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "mood",
                table: "daily_checkins",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "stress",
                table: "daily_checkins",
                type: "integer",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "ck_daily_checkins_mood",
                table: "daily_checkins",
                sql: "mood BETWEEN 1 AND 5");

            migrationBuilder.AddCheckConstraint(
                name: "ck_daily_checkins_stress",
                table: "daily_checkins",
                sql: "stress BETWEEN 0 AND 10");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_daily_checkins_mood",
                table: "daily_checkins");

            migrationBuilder.DropCheckConstraint(
                name: "ck_daily_checkins_stress",
                table: "daily_checkins");

            migrationBuilder.DropColumn(
                name: "mood",
                table: "daily_checkins");

            migrationBuilder.DropColumn(
                name: "stress",
                table: "daily_checkins");
        }
    }
}
