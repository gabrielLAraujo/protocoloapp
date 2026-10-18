using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.DailyCheckins;

namespace ProtocoloApp.Api.Shared.Data;

/// <summary>Application database: Identity, the refresh tokens and the synchronized entities. Features add their sets as they land.</summary>
public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    public DbSet<DailyCheckin> DailyCheckins => Set<DailyCheckin>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        base.OnModelCreating(builder);
        builder.HasSequence<long>(SyncVersion.SequenceName);
        builder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
