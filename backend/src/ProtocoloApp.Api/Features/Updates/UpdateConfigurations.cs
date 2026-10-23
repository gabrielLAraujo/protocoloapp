using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Updates;

/// <summary>Table <c>questionnaire_templates</c>: one live row per user, the document as <c>jsonb</c>.</summary>
public sealed class QuestionnaireTemplateConfiguration : IEntityTypeConfiguration<QuestionnaireTemplate>
{
    public void Configure(EntityTypeBuilder<QuestionnaireTemplate> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).ValueGeneratedNever();
        builder.Property(t => t.Document).HasColumnType("jsonb");

        // One live template per user.
        builder.HasIndex(t => t.UserId).IsUnique().HasFilter("deleted_at IS NULL");
        // Pull: WHERE user_id = @user AND version > @since ORDER BY version.
        builder.HasIndex(t => new { t.UserId, t.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>Table <c>update_cycles</c>: one cycle per protocol version, status as text, answers and photos as <c>jsonb</c>.</summary>
public sealed class UpdateCycleConfiguration : IEntityTypeConfiguration<UpdateCycle>
{
    public void Configure(EntityTypeBuilder<UpdateCycle> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable(table => table.HasCheckConstraint("ck_update_cycles_status", $"status IN {EnumText.SqlList<UpdateCycleStatus>()}"));

        builder.HasKey(c => c.Id);
        builder.Property(c => c.Id).ValueGeneratedNever();
        builder.Property(c => c.Status).HasConversion(EnumText.Converter<UpdateCycleStatus>()).HasMaxLength(16);
        builder.Property(c => c.Answers).HasColumnType("jsonb");
        builder.Property(c => c.Photos).HasColumnType("jsonb");

        builder.HasIndex(c => new { c.UserId, c.ProtocolVersionId }).IsUnique();
        builder.HasIndex(c => new { c.UserId, c.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<PlanVersion>().WithMany().HasForeignKey(c => c.ProtocolVersionId).OnDelete(DeleteBehavior.Restrict);
    }
}
