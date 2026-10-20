using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>Table <c>exercises</c>.</summary>
public sealed class ExerciseConfiguration : IEntityTypeConfiguration<Exercise>
{
    public void Configure(EntityTypeBuilder<Exercise> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable(table => table.HasCheckConstraint(
            "ck_exercises_primary_muscle_group",
            $"primary_muscle_group IN {EnumText.SqlList<MuscleGroup>()}"));

        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).ValueGeneratedNever();
        builder.Property(e => e.Name).HasMaxLength(Exercise.MaxNameLength);
        builder.Property(e => e.NormalizedName).HasMaxLength(Exercise.MaxNameLength);
        builder.Property(e => e.PrimaryMuscleGroup).HasConversion(EnumText.Converter<MuscleGroup>()).HasMaxLength(16);
        builder.Property(e => e.Aliases).HasColumnType("text[]");
        builder.Property(e => e.CatalogId).HasColumnType("text");

        builder.HasIndex(e => new { e.UserId, e.NormalizedName }).IsUnique();
        // Pull: WHERE user_id = @user AND version > @since ORDER BY version.
        builder.HasIndex(e => new { e.UserId, e.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
