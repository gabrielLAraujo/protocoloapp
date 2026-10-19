using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>Table <c>plan_versions</c>; enums as text, documents as <c>jsonb</c>.</summary>
public sealed class PlanVersionConfiguration : IEntityTypeConfiguration<PlanVersion>
{
    public void Configure(EntityTypeBuilder<PlanVersion> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_plan_versions_kind", $"kind IN {EnumText.SqlList<PlanKind>()}");
            table.HasCheckConstraint("ck_plan_versions_status", $"status IN {EnumText.SqlList<PlanStatus>()}");
        });

        builder.HasKey(p => p.Id);
        builder.Property(p => p.Id).ValueGeneratedNever();
        builder.Property(p => p.Kind).HasConversion(EnumText.Converter<PlanKind>()).HasMaxLength(16);
        builder.Property(p => p.Status).HasConversion(EnumText.Converter<PlanStatus>()).HasMaxLength(16);
        builder.Property(p => p.Document).HasColumnType("jsonb");
        builder.Property(p => p.RawExtraction).HasColumnType("jsonb");
        builder.Property(p => p.NewExercises).HasColumnType("jsonb");
        builder.Property(p => p.LowConfidence).HasColumnType("text[]");
        builder.Property(p => p.ExtractionError).HasMaxLength(64);

        // One active version per user and kind.
        builder.HasIndex(p => new { p.UserId, p.Kind }).IsUnique().HasFilter("status = 'active' AND deleted_at IS NULL");
        // Pull: WHERE user_id = @user AND version > @since ORDER BY version.
        builder.HasIndex(p => new { p.UserId, p.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<FileRecord>().WithMany().HasForeignKey(p => p.SourceFileId).OnDelete(DeleteBehavior.Restrict);
    }
}
