using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProtocoloApp.Api.Shared.Data.Migrations
{
    /// <inheritdoc />
    public partial class SyncAndDailyCheckin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateSequence(
                name: "sync_version_seq");

            migrationBuilder.CreateTable(
                name: "daily_checkins",
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
                    sleep_quality = table.Column<int>(type: "integer", nullable: false),
                    bowel = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    energy_wake = table.Column<int>(type: "integer", nullable: false),
                    energy_day = table.Column<int>(type: "integer", nullable: false),
                    anxiety = table.Column<int>(type: "integer", nullable: false),
                    water_l = table.Column<decimal>(type: "numeric(4,2)", precision: 4, scale: 2, nullable: false),
                    weight_kg = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: true),
                    note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_daily_checkins", x => x.id);
                    table.CheckConstraint("ck_daily_checkins_anxiety", "anxiety BETWEEN 1 AND 5");
                    table.CheckConstraint("ck_daily_checkins_bowel", "bowel IN ('normal', 'loose', 'constipated')");
                    table.CheckConstraint("ck_daily_checkins_energy_day", "energy_day BETWEEN 1 AND 5");
                    table.CheckConstraint("ck_daily_checkins_energy_wake", "energy_wake BETWEEN 1 AND 5");
                    table.CheckConstraint("ck_daily_checkins_sleep_quality", "sleep_quality BETWEEN 1 AND 5");
                    table.CheckConstraint("ck_daily_checkins_water_l", "water_l BETWEEN 0 AND 15");
                    table.CheckConstraint("ck_daily_checkins_weight_kg", "weight_kg IS NULL OR weight_kg BETWEEN 30 AND 300");
                    table.ForeignKey(
                        name: "fk_daily_checkins_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_daily_checkins_user_id_date",
                table: "daily_checkins",
                columns: new[] { "user_id", "date" },
                unique: true,
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_daily_checkins_user_id_version",
                table: "daily_checkins",
                columns: new[] { "user_id", "version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "daily_checkins");

            migrationBuilder.DropSequence(
                name: "sync_version_seq");
        }
    }
}
