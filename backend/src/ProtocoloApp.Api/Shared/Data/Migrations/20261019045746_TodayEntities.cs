using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProtocoloApp.Api.Shared.Data.Migrations
{
    /// <inheritdoc />
    public partial class TodayEntities : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "adherence_logs",
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
                    target_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    target_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_adherence_logs", x => x.id);
                    table.CheckConstraint("ck_adherence_logs_reason", "reason IS NULL OR (status <> 'done' AND reason IN ('no_appetite', 'no_time', 'felt_sick', 'free_meal', 'other'))");
                    table.CheckConstraint("ck_adherence_logs_status", "status IN ('done', 'partial', 'missed')");
                    table.CheckConstraint("ck_adherence_logs_target_type", "target_type IN ('meal', 'protocol_item', 'cardio', 'workout', 'checkin')");
                    table.ForeignKey(
                        name: "fk_adherence_logs_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "schedule_slots",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    slot = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    day_type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    time = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    reminder_enabled = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_schedule_slots", x => x.id);
                    table.CheckConstraint("ck_schedule_slots_day_type", "day_type IN ('training', 'off')");
                    table.ForeignKey(
                        name: "fk_schedule_slots_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_adherence_logs_user_id_date_target_type_target_key",
                table: "adherence_logs",
                columns: new[] { "user_id", "date", "target_type", "target_key" },
                unique: true,
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_adherence_logs_user_id_version",
                table: "adherence_logs",
                columns: new[] { "user_id", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_schedule_slots_user_id_slot_day_type",
                table: "schedule_slots",
                columns: new[] { "user_id", "slot", "day_type" },
                unique: true,
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_schedule_slots_user_id_version",
                table: "schedule_slots",
                columns: new[] { "user_id", "version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "adherence_logs");

            migrationBuilder.DropTable(
                name: "schedule_slots");
        }
    }
}
