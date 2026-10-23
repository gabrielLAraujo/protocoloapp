using System;
using System.Text.Json;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProtocoloApp.Api.Shared.Data.Migrations
{
    /// <inheritdoc />
    public partial class UpdateCycles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "questionnaire_templates",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    document = table.Column<JsonDocument>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_questionnaire_templates", x => x.id);
                    table.ForeignKey(
                        name: "fk_questionnaire_templates_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "update_cycles",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<long>(type: "bigint", nullable: false),
                    client_updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    protocol_version_id = table.Column<Guid>(type: "uuid", nullable: false),
                    period_start = table.Column<DateOnly>(type: "date", nullable: false),
                    period_end = table.Column<DateOnly>(type: "date", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    answers = table.Column<JsonDocument>(type: "jsonb", nullable: false),
                    photos = table.Column<JsonDocument>(type: "jsonb", nullable: false),
                    sent_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_update_cycles", x => x.id);
                    table.CheckConstraint("ck_update_cycles_status", "status IN ('collecting', 'draft', 'sent')");
                    table.ForeignKey(
                        name: "fk_update_cycles_asp_net_users_user_id",
                        column: x => x.user_id,
                        principalTable: "AspNetUsers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_update_cycles_plan_versions_protocol_version_id",
                        column: x => x.protocol_version_id,
                        principalTable: "plan_versions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_questionnaire_templates_user_id",
                table: "questionnaire_templates",
                column: "user_id",
                unique: true,
                filter: "deleted_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_questionnaire_templates_user_id_version",
                table: "questionnaire_templates",
                columns: new[] { "user_id", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_update_cycles_protocol_version_id",
                table: "update_cycles",
                column: "protocol_version_id");

            migrationBuilder.CreateIndex(
                name: "ix_update_cycles_user_id_protocol_version_id",
                table: "update_cycles",
                columns: new[] { "user_id", "protocol_version_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_update_cycles_user_id_version",
                table: "update_cycles",
                columns: new[] { "user_id", "version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "questionnaire_templates");

            migrationBuilder.DropTable(
                name: "update_cycles");
        }
    }
}
