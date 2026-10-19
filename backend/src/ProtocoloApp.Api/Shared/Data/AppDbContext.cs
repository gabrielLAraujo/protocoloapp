using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Features.Today;
using ProtocoloApp.Api.Features.Workouts;

namespace ProtocoloApp.Api.Shared.Data;

/// <summary>Application database: Identity, the refresh tokens and the synchronized entities. Features add their sets as they land.</summary>
public class AppDbContext(DbContextOptions<AppDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    public DbSet<DailyCheckin> DailyCheckins => Set<DailyCheckin>();

    public DbSet<FileRecord> Files => Set<FileRecord>();

    public DbSet<PlanVersion> PlanVersions => Set<PlanVersion>();

    public DbSet<Exercise> Exercises => Set<Exercise>();

    public DbSet<WorkoutSession> WorkoutSessions => Set<WorkoutSession>();

    public DbSet<SetLog> SetLogs => Set<SetLog>();

    public DbSet<ExerciseChange> ExerciseChanges => Set<ExerciseChange>();

    public DbSet<RotationOverride> RotationOverrides => Set<RotationOverride>();

    public DbSet<ScheduleSlot> ScheduleSlots => Set<ScheduleSlot>();

    public DbSet<AdherenceLog> AdherenceLogs => Set<AdherenceLog>();

    public DbSet<AppSecret> AppSecrets => Set<AppSecret>();

    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();

    public DbSet<ReminderSend> ReminderSends => Set<ReminderSend>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        base.OnModelCreating(builder);
        builder.HasSequence<long>(SyncVersion.SequenceName);
        builder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
