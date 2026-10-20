using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace ProtocoloApp.Api.Features.ExerciseCatalog;

/// <summary>Table <c>catalog_exercises</c>.</summary>
public sealed class CatalogExerciseConfiguration : IEntityTypeConfiguration<CatalogExercise>
{
    public void Configure(EntityTypeBuilder<CatalogExercise> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable("catalog_exercises");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Id).HasColumnType("text").ValueGeneratedNever();
        builder.Property(e => e.Name).HasColumnType("text");
        builder.Property(e => e.BodyParts).HasColumnType("text[]");
        builder.Property(e => e.TargetMuscles).HasColumnType("text[]");
        builder.Property(e => e.SecondaryMuscles).HasColumnType("text[]");
        builder.Property(e => e.Equipments).HasColumnType("text[]");
        builder.Property(e => e.GifUrl).HasColumnType("text");
    }
}
