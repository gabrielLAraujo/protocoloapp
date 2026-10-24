using System;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProtocoloApp.Api.Shared.Data.Migrations
{
    /// <inheritdoc />
    public partial class HevySync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "external_id",
                table: "workout_sessions",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "external_title",
                table: "workout_sessions",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "external_updated_at",
                table: "workout_sessions",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "source",
                table: "workout_sessions",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "app");

            migrationBuilder.AddColumn<string>(
                name: "hevy_template_id",
                table: "set_logs",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "rpe",
                table: "set_logs",
                type: "numeric(3,1)",
                precision: 3,
                scale: 1,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "hevy_connections",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    api_key_cipher = table.Column<byte[]>(type: "bytea", nullable: false),
                    key_last4 = table.Column<string>(type: "character varying(4)", maxLength: 4, nullable: false),
                    sync_from = table.Column<DateOnly>(type: "date", nullable: false),
                    cursor = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_attempt_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_success_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_error = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    last_result = table.Column<JsonDocument>(type: "jsonb", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_hevy_connections", x => x.user_id);
                    table.ForeignKey(
                        name: "fk_hevy_connections_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "hevy_exercise_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    template_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    exercise_id = table.Column<Guid>(type: "uuid", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    created_exercise = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_hevy_exercise_links", x => x.id);
                    table.CheckConstraint("ck_hevy_exercise_links_status", "status IN ('auto', 'pending', 'confirmed')");
                    table.ForeignKey(
                        name: "fk_hevy_exercise_links_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_hevy_exercise_links_exercises_exercise_id",
                        column: x => x.exercise_id,
                        principalTable: "exercises",
                        principalColumn: "id");
                });

            migrationBuilder.CreateIndex(
                name: "ix_workout_sessions_user_id_source_external_id",
                table: "workout_sessions",
                columns: new[] { "user_id", "source", "external_id" },
                unique: true,
                filter: "external_id IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_workout_sessions_source",
                table: "workout_sessions",
                sql: "source IN ('app', 'hevy')");

            migrationBuilder.CreateIndex(
                name: "ix_set_logs_user_id_hevy_template_id",
                table: "set_logs",
                columns: new[] { "user_id", "hevy_template_id" });

            migrationBuilder.AddCheckConstraint(
                name: "ck_set_logs_rpe",
                table: "set_logs",
                sql: "rpe IS NULL OR rpe BETWEEN 1 AND 10");

            migrationBuilder.CreateIndex(
                name: "ix_hevy_exercise_links_exercise_id",
                table: "hevy_exercise_links",
                column: "exercise_id");

            migrationBuilder.CreateIndex(
                name: "ix_hevy_exercise_links_user_id_template_id",
                table: "hevy_exercise_links",
                columns: new[] { "user_id", "template_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "hevy_connections");

            migrationBuilder.DropTable(
                name: "hevy_exercise_links");

            migrationBuilder.DropIndex(
                name: "ix_workout_sessions_user_id_source_external_id",
                table: "workout_sessions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_workout_sessions_source",
                table: "workout_sessions");

            migrationBuilder.DropIndex(
                name: "ix_set_logs_user_id_hevy_template_id",
                table: "set_logs");

            migrationBuilder.DropCheckConstraint(
                name: "ck_set_logs_rpe",
                table: "set_logs");

            migrationBuilder.DropColumn(
                name: "external_id",
                table: "workout_sessions");

            migrationBuilder.DropColumn(
                name: "external_title",
                table: "workout_sessions");

            migrationBuilder.DropColumn(
                name: "external_updated_at",
                table: "workout_sessions");

            migrationBuilder.DropColumn(
                name: "source",
                table: "workout_sessions");

            migrationBuilder.DropColumn(
                name: "hevy_template_id",
                table: "set_logs");

            migrationBuilder.DropColumn(
                name: "rpe",
                table: "set_logs");
        }
    }
}
