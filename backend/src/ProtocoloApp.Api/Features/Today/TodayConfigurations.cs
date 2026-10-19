using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Today;

/// <summary>Table <c>schedule_slots</c>: one live row per user, slot and day type.</summary>
public sealed class ScheduleSlotConfiguration : IEntityTypeConfiguration<ScheduleSlot>
{
    public void Configure(EntityTypeBuilder<ScheduleSlot> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable(table => table.HasCheckConstraint("ck_schedule_slots_day_type", $"day_type IN {EnumText.SqlList<DayType>()}"));

        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.Slot).HasMaxLength(ScheduleSlot.MaxSlotLength);
        builder.Property(s => s.DayType).HasConversion(EnumText.Converter<DayType>()).HasMaxLength(16);
        builder.Property(s => s.Time).HasColumnType("time without time zone");

        builder.HasIndex(s => new { s.UserId, s.Slot, s.DayType }).IsUnique().HasFilter("deleted_at IS NULL");
        builder.HasIndex(s => new { s.UserId, s.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>Table <c>adherence_logs</c>: one live row per user, date, target type and target key.</summary>
public sealed class AdherenceLogConfiguration : IEntityTypeConfiguration<AdherenceLog>
{
    public void Configure(EntityTypeBuilder<AdherenceLog> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_adherence_logs_target_type", $"target_type IN {EnumText.SqlList<AdherenceTargetType>()}");
            table.HasCheckConstraint("ck_adherence_logs_status", $"status IN {EnumText.SqlList<AdherenceStatus>()}");
            table.HasCheckConstraint(
                "ck_adherence_logs_reason",
                "reason IS NULL OR (status <> 'done' AND reason IN ('no_appetite', 'no_time', 'felt_sick', 'free_meal', 'other'))");
        });

        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever();
        builder.Property(a => a.TargetType).HasConversion(EnumText.Converter<AdherenceTargetType>()).HasMaxLength(16);
        builder.Property(a => a.TargetKey).HasMaxLength(AdherenceLog.MaxKeyLength);
        builder.Property(a => a.Status).HasConversion(EnumText.Converter<AdherenceStatus>()).HasMaxLength(16);
        builder.Property(a => a.Reason).HasMaxLength(AdherenceLog.MaxReasonLength);
        builder.Property(a => a.Note).HasMaxLength(AdherenceLog.MaxNoteLength);

        builder.HasIndex(a => new { a.UserId, a.Date, a.TargetType, a.TargetKey }).IsUnique().HasFilter("deleted_at IS NULL");
        builder.HasIndex(a => new { a.UserId, a.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
