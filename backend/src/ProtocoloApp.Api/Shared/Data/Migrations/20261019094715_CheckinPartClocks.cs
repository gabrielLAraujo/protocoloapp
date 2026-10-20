using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProtocoloApp.Api.Shared.Data.Migrations
{
    /// <inheritdoc />
    public partial class CheckinPartClocks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "cardio_client_updated_at",
                table: "daily_checkins",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "evening_client_updated_at",
                table: "daily_checkins",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "morning_client_updated_at",
                table: "daily_checkins",
                type: "timestamp with time zone",
                nullable: true);

            // Rows written before the per-part clocks were full overwrites: each part was last written at the row clock.
            migrationBuilder.Sql(
                "UPDATE daily_checkins SET morning_client_updated_at = client_updated_at, " +
                "evening_client_updated_at = client_updated_at, cardio_client_updated_at = client_updated_at;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "cardio_client_updated_at",
                table: "daily_checkins");

            migrationBuilder.DropColumn(
                name: "evening_client_updated_at",
                table: "daily_checkins");

            migrationBuilder.DropColumn(
                name: "morning_client_updated_at",
                table: "daily_checkins");
        }
    }
}
