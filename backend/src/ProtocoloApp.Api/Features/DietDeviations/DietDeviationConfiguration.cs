using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.DietDeviations;

/// <summary>Table <c>diet_deviations</c>: any number of rows per user and date.</summary>
public sealed class DietDeviationConfiguration : IEntityTypeConfiguration<DietDeviation>
{
    public void Configure(EntityTypeBuilder<DietDeviation> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.HasKey(d => d.Id);
        builder.Property(d => d.Id).ValueGeneratedNever();
        builder.Property(d => d.MealKey).HasMaxLength(DietDeviation.MaxKeyLength);
        builder.Property(d => d.Time).HasColumnType("time without time zone");
        builder.Property(d => d.Description).HasMaxLength(DietDeviation.MaxDescriptionLength);
        builder.Property(d => d.Quantity).HasMaxLength(DietDeviation.MaxQuantityLength);

        builder.HasIndex(d => new { d.UserId, d.Date });
        builder.HasIndex(d => new { d.UserId, d.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(d => d.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
