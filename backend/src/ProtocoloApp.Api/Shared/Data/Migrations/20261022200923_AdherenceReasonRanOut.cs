using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProtocoloApp.Api.Shared.Data.Migrations
{
    /// <inheritdoc />
    public partial class AdherenceReasonRanOut : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_adherence_logs_reason",
                table: "adherence_logs");

            migrationBuilder.AddCheckConstraint(
                name: "ck_adherence_logs_reason",
                table: "adherence_logs",
                sql: "reason IS NULL OR (status <> 'done' AND (reason IN ('no_appetite', 'no_time', 'felt_sick', 'free_meal', 'other') OR (reason = 'ran_out' AND target_type = 'protocol_item')))");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_adherence_logs_reason",
                table: "adherence_logs");

            migrationBuilder.AddCheckConstraint(
                name: "ck_adherence_logs_reason",
                table: "adherence_logs",
                sql: "reason IS NULL OR (status <> 'done' AND reason IN ('no_appetite', 'no_time', 'felt_sick', 'free_meal', 'other'))");
        }
    }
}
