using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>Table <c>hevy_connections</c>: one row per user, keyed by the user.</summary>
public sealed class HevyConnectionConfiguration : IEntityTypeConfiguration<HevyConnection>
{
    public void Configure(EntityTypeBuilder<HevyConnection> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.HasKey(c => c.UserId);
        builder.Property(c => c.UserId).ValueGeneratedNever();
        builder.Property(c => c.KeyLast4).HasMaxLength(HevyConnection.KeyLast4Length);
        builder.Property(c => c.LastError).HasMaxLength(HevyConnection.MaxLastErrorLength);
        builder.Property(c => c.LastResult).HasColumnType("jsonb");

        builder.HasOne<AppUser>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>Table <c>hevy_exercise_links</c>: one link per user and Hevy template, status as text.</summary>
public sealed class HevyExerciseLinkConfiguration : IEntityTypeConfiguration<HevyExerciseLink>
{
    public void Configure(EntityTypeBuilder<HevyExerciseLink> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable(table => table.HasCheckConstraint("ck_hevy_exercise_links_status", $"status IN {EnumText.SqlList<HevyLinkStatus>()}"));

        builder.HasKey(l => l.Id);
        builder.Property(l => l.Id).ValueGeneratedNever();
        builder.Property(l => l.TemplateId).HasMaxLength(HevyExerciseLink.MaxTemplateIdLength);
        builder.Property(l => l.Title).HasMaxLength(HevyExerciseLink.MaxTitleLength);
        builder.Property(l => l.Status).HasConversion(EnumText.Converter<HevyLinkStatus>()).HasMaxLength(16);

        builder.HasIndex(l => new { l.UserId, l.TemplateId }).IsUnique();
        builder.HasIndex(l => l.ExerciseId);

        // Same rule as the workout tables: NO ACTION, so deleting a user cascades through every table.
        builder.HasOne<AppUser>().WithMany().HasForeignKey(l => l.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Exercise>().WithMany().HasForeignKey(l => l.ExerciseId).OnDelete(DeleteBehavior.NoAction);
    }
}
