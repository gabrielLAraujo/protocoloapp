using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.DailyCheckins;

/// <summary>Table <c>daily_checkins</c>. The payload limits are enforced again as check constraints.</summary>
public sealed class DailyCheckinConfiguration : IEntityTypeConfiguration<DailyCheckin>
{
    public void Configure(EntityTypeBuilder<DailyCheckin> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable(table =>
        {
            foreach (var column in new[] { "sleep_quality", "energy_wake", "energy_day", "anxiety" })
                table.HasCheckConstraint($"ck_daily_checkins_{column}", $"{column} BETWEEN {DailyCheckin.MinScore} AND {DailyCheckin.MaxScore}");

            table.HasCheckConstraint(
                "ck_daily_checkins_bowel",
                $"bowel IN ('{BowelText.Normal}', '{BowelText.Loose}', '{BowelText.Constipated}')");
            table.HasCheckConstraint("ck_daily_checkins_water_l", $"water_l BETWEEN 0 AND {DailyCheckin.MaxWaterL}");
            table.HasCheckConstraint(
                "ck_daily_checkins_weight_kg",
                $"weight_kg IS NULL OR weight_kg BETWEEN {DailyCheckin.MinWeightKg} AND {DailyCheckin.MaxWeightKg}");
        });

        builder.HasKey(c => c.Id);
        builder.Property(c => c.Id).ValueGeneratedNever();
        builder.Property(c => c.Bowel)
            .HasConversion(v => BowelText.ToText(v), v => BowelText.Parse(v))
            .HasMaxLength(16);
        builder.Property(c => c.WaterL).HasPrecision(4, 2);
        builder.Property(c => c.WeightKg).HasPrecision(5, 2);
        builder.Property(c => c.Note).HasMaxLength(DailyCheckin.MaxNoteLength);

        // One live check-in per user and day; deleted ones do not hold the date.
        builder.HasIndex(c => new { c.UserId, c.Date }).IsUnique().HasFilter("deleted_at IS NULL");
        // Pull: WHERE user_id = @user AND version > @since ORDER BY version.
        builder.HasIndex(c => new { c.UserId, c.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
