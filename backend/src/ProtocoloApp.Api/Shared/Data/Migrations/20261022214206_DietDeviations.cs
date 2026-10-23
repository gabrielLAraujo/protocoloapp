using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProtocoloApp.Api.Shared.Data.Migrations
{
    /// <inheritdoc />
    public partial class DietDeviations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "diet_deviations",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    date = table.Column<DateOnly>(type: "date", nullable: false),
                    meal_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    time = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    description = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    quantity = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_diet_deviations", x => x.id);
                    table.ForeignKey(
                        name: "fk_diet_deviations_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_diet_deviations_user_id_date",
                table: "diet_deviations",
                columns: new[] { "user_id", "date" });

            migrationBuilder.CreateIndex(
                name: "ix_diet_deviations_user_id_version",
                table: "diet_deviations",
                columns: new[] { "user_id", "version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "diet_deviations");
        }
    }
}
