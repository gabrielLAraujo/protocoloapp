using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProtocoloApp.Api.Shared.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkoutLogging : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "cardio_done",
                table: "daily_checkins",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "cardio_minutes",
                table: "daily_checkins",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "rotation_overrides",
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
                    workout_day_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_rotation_overrides", x => x.id);
                    table.ForeignKey(
                        name: "fk_rotation_overrides_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "workout_sessions",
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
                    plan_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    workout_day_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workout_sessions", x => x.id);
                    table.ForeignKey(
                        name: "fk_workout_sessions_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_workout_sessions_plan_versions_plan_version_id",
                        column: x => x.plan_version_id,
                        principalTable: "plan_versions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "exercise_changes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    planned_exercise_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    replacement_exercise_id = table.Column<Guid>(type: "uuid", nullable: true),
                    note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_exercise_changes", x => x.id);
                    table.CheckConstraint("ck_exercise_changes_action", "action IN ('swapped', 'skipped')");
                    table.CheckConstraint("ck_exercise_changes_replacement", "action <> 'swapped' OR replacement_exercise_id IS NOT NULL");
                    table.ForeignKey(
                        name: "fk_exercise_changes_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_exercise_changes_exercises_replacement_exercise_id",
                        column: x => x.replacement_exercise_id,
                        principalTable: "exercises",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "fk_exercise_changes_workout_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "workout_sessions",
                        principalColumn: "id");
                });

            migrationBuilder.CreateTable(
                name: "set_logs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    session_id = table.Column<Guid>(type: "uuid", nullable: false),
                    exercise_id = table.Column<Guid>(type: "uuid", nullable: false),
                    planned_exercise_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    set_index = table.Column<int>(type: "integer", nullable: false),
                    weight_kg = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    reps = table.Column<int>(type: "integer", nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    parent_set_id = table.Column<Guid>(type: "uuid", nullable: true),
                    completed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_set_logs", x => x.id);
                    table.CheckConstraint("ck_set_logs_kind", "kind IN ('normal', 'drop', 'partial', 'rest_pause', 'warmup')");
                    table.CheckConstraint("ck_set_logs_reps", "reps BETWEEN 0 AND 200");
                    table.CheckConstraint("ck_set_logs_set_index", "set_index BETWEEN 0 AND 50");
                    table.CheckConstraint("ck_set_logs_weight_kg", "weight_kg BETWEEN 0 AND 1000");
                    table.ForeignKey(
                        name: "fk_set_logs_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_set_logs_exercises_exercise_id",
                        column: x => x.exercise_id,
                        principalTable: "exercises",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "fk_set_logs_set_logs_parent_set_id",
                        column: x => x.parent_set_id,
                        principalTable: "set_logs",
                        principalColumn: "id");
                    table.ForeignKey(
                        name: "fk_set_logs_workout_sessions_session_id",
                        column: x => x.session_id,
                        principalTable: "workout_sessions",
                        principalColumn: "id");
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_daily_checkins_cardio_minutes",
                table: "daily_checkins",
                sql: "cardio_minutes IS NULL OR (cardio_done IS TRUE AND cardio_minutes BETWEEN 0 AND 300)");

            migrationBuilder.CreateIndex(
                name: "ix_exercise_changes_replacement_exercise_id",
                table: "exercise_changes",
                column: "replacement_exercise_id");

            migrationBuilder.CreateIndex(
                name: "ix_exercise_changes_session_id",
                table: "exercise_changes",
                column: "session_id");

            migrationBuilder.CreateIndex(
                name: "ix_exercise_changes_user_id_session_id",
                table: "exercise_changes",
                columns: new[] { "user_id", "session_id" });

            migrationBuilder.CreateIndex(
                name: "ix_exercise_changes_user_id_version",
                table: "exercise_changes",
                columns: new[] { "user_id", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_rotation_overrides_user_id_date",
                table: "rotation_overrides",
                columns: new[] { "user_id", "date" },
                unique: true,
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_rotation_overrides_user_id_version",
                table: "rotation_overrides",
                columns: new[] { "user_id", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_set_logs_exercise_id",
                table: "set_logs",
                column: "exercise_id");

            migrationBuilder.CreateIndex(
                name: "ix_set_logs_parent_set_id",
                table: "set_logs",
                column: "parent_set_id");

            migrationBuilder.CreateIndex(
                name: "ix_set_logs_session_id",
                table: "set_logs",
                column: "session_id");

            migrationBuilder.CreateIndex(
                name: "ix_set_logs_user_id_exercise_id",
                table: "set_logs",
                columns: new[] { "user_id", "exercise_id" });

            migrationBuilder.CreateIndex(
                name: "ix_set_logs_user_id_session_id",
                table: "set_logs",
                columns: new[] { "user_id", "session_id" });

            migrationBuilder.CreateIndex(
                name: "ix_set_logs_user_id_version",
                table: "set_logs",
                columns: new[] { "user_id", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_workout_sessions_plan_version_id",
                table: "workout_sessions",
                column: "plan_version_id");

            migrationBuilder.CreateIndex(
                name: "ix_workout_sessions_user_id_date",
                table: "workout_sessions",
                columns: new[] { "user_id", "date" });

            migrationBuilder.CreateIndex(
                name: "ix_workout_sessions_user_id_version",
                table: "workout_sessions",
                columns: new[] { "user_id", "version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "exercise_changes");

            migrationBuilder.DropTable(
                name: "rotation_overrides");

            migrationBuilder.DropTable(
                name: "set_logs");

            migrationBuilder.DropTable(
                name: "workout_sessions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_daily_checkins_cardio_minutes",
                table: "daily_checkins");

            migrationBuilder.DropColumn(
                name: "cardio_done",
                table: "daily_checkins");

            migrationBuilder.DropColumn(
                name: "cardio_minutes",
                table: "daily_checkins");
        }
    }
}
