using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Files;

/// <summary>Table <c>files</c>; enums are stored as text.</summary>
public sealed class FileRecordConfiguration : IEntityTypeConfiguration<FileRecord>
{
    public void Configure(EntityTypeBuilder<FileRecord> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable(table => table.HasCheckConstraint("ck_files_size_bytes", $"size_bytes BETWEEN 1 AND {FileRules.MaxSizeBytes}"));

        builder.HasKey(f => f.Id);
        builder.Property(f => f.Id).ValueGeneratedNever();
        builder.Property(f => f.StorageKey).HasMaxLength(200);
        builder.Property(f => f.ContentType).HasMaxLength(100);
        builder.Property(f => f.Kind).HasConversion<string>().HasMaxLength(32);
        builder.Property(f => f.Status).HasConversion<string>().HasMaxLength(16);

        builder.HasIndex(f => f.StorageKey).IsUnique();
        builder.HasIndex(f => new { f.UserId, f.CreatedAt });

        builder.HasOne<AppUser>().WithMany().HasForeignKey(f => f.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
