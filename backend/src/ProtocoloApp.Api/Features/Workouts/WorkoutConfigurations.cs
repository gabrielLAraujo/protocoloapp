using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Workouts;

// The cross-row references are plain foreign keys with NO ACTION (checked at the end of the statement, so deleting a user
// cascades through every table); same-user ownership is enforced by the sync handlers, rows are only soft-deleted.

/// <summary>Table <c>workout_sessions</c>.</summary>
public sealed class WorkoutSessionConfiguration : IEntityTypeConfiguration<WorkoutSession>
{
    public void Configure(EntityTypeBuilder<WorkoutSession> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.WorkoutDayKey).HasMaxLength(WorkoutSession.MaxKeyLength);
        builder.Property(s => s.Note).HasMaxLength(WorkoutSession.MaxNoteLength);
        builder.Property(s => s.ExerciseNotes).HasColumnType("jsonb");

        builder.HasIndex(s => new { s.UserId, s.Date });
        builder.HasIndex(s => new { s.UserId, s.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<PlanVersion>().WithMany().HasForeignKey(s => s.PlanVersionId).OnDelete(DeleteBehavior.NoAction);
    }
}

/// <summary>Table <c>set_logs</c>.</summary>
public sealed class SetLogConfiguration : IEntityTypeConfiguration<SetLog>
{
    public void Configure(EntityTypeBuilder<SetLog> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_set_logs_kind", $"kind IN {EnumText.SqlList<SetKind>()}");
            table.HasCheckConstraint("ck_set_logs_weight_kg", $"weight_kg BETWEEN 0 AND {SetLog.MaxWeightKg}");
            table.HasCheckConstraint("ck_set_logs_reps", $"reps BETWEEN 0 AND {SetLog.MaxReps}");
            table.HasCheckConstraint("ck_set_logs_set_index", $"set_index BETWEEN 0 AND {SetLog.MaxSetIndex}");
        });

        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.PlannedExerciseKey).HasMaxLength(WorkoutSession.MaxKeyLength);
        builder.Property(s => s.WeightKg).HasPrecision(6, 2);
        builder.Property(s => s.Kind).HasConversion(EnumText.Converter<SetKind>()).HasMaxLength(16);

        builder.HasIndex(s => new { s.UserId, s.SessionId });
        builder.HasIndex(s => new { s.UserId, s.ExerciseId });
        builder.HasIndex(s => new { s.UserId, s.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<WorkoutSession>().WithMany().HasForeignKey(s => s.SessionId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<Exercise>().WithMany().HasForeignKey(s => s.ExerciseId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<SetLog>().WithMany().HasForeignKey(s => s.ParentSetId).OnDelete(DeleteBehavior.NoAction);
    }
}

/// <summary>Table <c>exercise_changes</c>.</summary>
public sealed class ExerciseChangeConfiguration : IEntityTypeConfiguration<ExerciseChange>
{
    public void Configure(EntityTypeBuilder<ExerciseChange> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_exercise_changes_action", $"action IN {EnumText.SqlList<ExerciseChangeAction>()}");
            table.HasCheckConstraint("ck_exercise_changes_replacement", "action <> 'swapped' OR replacement_exercise_id IS NOT NULL");
        });

        builder.HasKey(c => c.Id);
        builder.Property(c => c.Id).ValueGeneratedNever();
        builder.Property(c => c.PlannedExerciseKey).HasMaxLength(WorkoutSession.MaxKeyLength);
        builder.Property(c => c.Action).HasConversion(EnumText.Converter<ExerciseChangeAction>()).HasMaxLength(16);
        builder.Property(c => c.Note).HasMaxLength(WorkoutSession.MaxNoteLength);

        builder.HasIndex(c => new { c.UserId, c.SessionId });
        builder.HasIndex(c => new { c.UserId, c.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<WorkoutSession>().WithMany().HasForeignKey(c => c.SessionId).OnDelete(DeleteBehavior.NoAction);
        builder.HasOne<Exercise>().WithMany().HasForeignKey(c => c.ReplacementExerciseId).OnDelete(DeleteBehavior.NoAction);
    }
}

/// <summary>Table <c>rotation_overrides</c>: one live override per user and date.</summary>
public sealed class RotationOverrideConfiguration : IEntityTypeConfiguration<RotationOverride>
{
    public void Configure(EntityTypeBuilder<RotationOverride> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.HasKey(o => o.Id);
        builder.Property(o => o.Id).ValueGeneratedNever();
        builder.Property(o => o.WorkoutDayKey).HasMaxLength(WorkoutSession.MaxKeyLength);

        builder.HasIndex(o => new { o.UserId, o.Date }).IsUnique().HasFilter("deleted_at IS NULL");
        builder.HasIndex(o => new { o.UserId, o.Version }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(o => o.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
