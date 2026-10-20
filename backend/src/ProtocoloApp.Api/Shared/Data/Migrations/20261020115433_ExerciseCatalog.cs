using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProtocoloApp.Api.Shared.Data.Migrations
{
    /// <inheritdoc />
    public partial class ExerciseCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "catalog_id",
                table: "exercises",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "catalog_exercises",
                columns: table => new
                {
                    id = table.Column<string>(type: "text", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    body_parts = table.Column<string[]>(type: "text[]", nullable: false),
                    target_muscles = table.Column<string[]>(type: "text[]", nullable: false),
                    secondary_muscles = table.Column<string[]>(type: "text[]", nullable: false),
                    equipments = table.Column<string[]>(type: "text[]", nullable: false),
                    gif_url = table.Column<string>(type: "text", nullable: true),
                    synced_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_catalog_exercises", x => x.id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "catalog_exercises");

            migrationBuilder.DropColumn(
                name: "catalog_id",
                table: "exercises");
        }
    }
}
