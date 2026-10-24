using System.Text.Json;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Workouts;

/// <summary>Syncs <see cref="WorkoutSession"/> as <c>workout_session</c>.</summary>
public sealed class WorkoutSessionSyncHandler(AppDbContext db, TimeProvider clock)
    : SyncHandler<WorkoutSession, WorkoutSessionPayload>(db, clock)
{
    public const string EntityName = "workout_session";

    private static readonly WorkoutSessionPayloadValidator PayloadValidator = new();

    public override string Entity => EntityName;

    protected override IValidator<WorkoutSessionPayload> Validator => PayloadValidator;

    protected override WorkoutSession Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    // Source and ExternalTitle belong to the server: a push (from any app version) never changes them.
    protected override void Apply(WorkoutSessionPayload payload, WorkoutSession entity)
    {
        entity.Date = payload.Date!.Value;
        entity.PlanVersionId = payload.PlanVersionId!.Value;
        entity.WorkoutDayKey = payload.WorkoutDayKey!;
        entity.StartedAt = payload.StartedAt!.Value;
        entity.EndedAt = payload.EndedAt;
        entity.Note = payload.Note;
        entity.ExerciseNotes = payload.Notes is { Count: > 0 } notes ? JsonSerializer.SerializeToDocument(notes) : null;
    }

    protected override WorkoutSessionPayload CreatePayload(WorkoutSession entity) => new()
    {
        Date = entity.Date,
        PlanVersionId = entity.PlanVersionId,
        WorkoutDayKey = entity.WorkoutDayKey,
        StartedAt = entity.StartedAt,
        EndedAt = entity.EndedAt,
        Note = entity.Note,
        Notes = entity.ExerciseNotes?.Deserialize<Dictionary<string, string?>>(),
        Source = EnumText.ToText(entity.Source),
        ExternalTitle = entity.ExternalTitle,
    };

    // The plan version may be archived (a session keeps pointing at the version it followed); it only has to be the user's.
    protected override async Task<string?> ValidateReferencesAsync(WorkoutSession entity, Guid userId, CancellationToken cancellationToken) =>
        await Db.PlanVersions.AnyAsync(p => p.Id == entity.PlanVersionId && p.UserId == userId && p.DeletedAt == null, cancellationToken)
            ? null
            : SyncErrors.InvalidReference;
}

/// <summary>Syncs <see cref="SetLog"/> as <c>set_log</c>.</summary>
public sealed class SetLogSyncHandler(AppDbContext db, TimeProvider clock) : SyncHandler<SetLog, SetLogPayload>(db, clock)
{
    public const string EntityName = "set_log";

    private static readonly SetLogPayloadValidator PayloadValidator = new();

    public override string Entity => EntityName;

    protected override IValidator<SetLogPayload> Validator => PayloadValidator;

    protected override SetLog Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    protected override void Apply(SetLogPayload payload, SetLog entity)
    {
        entity.SessionId = payload.SessionId!.Value;
        entity.ExerciseId = payload.ExerciseId!.Value;
        entity.PlannedExerciseKey = payload.PlannedExerciseKey;
        entity.SetIndex = payload.SetIndex!.Value;
        entity.WeightKg = payload.WeightKg!.Value;
        entity.Reps = payload.Reps!.Value;
        entity.Kind = EnumText.Parse<SetKind>(payload.Kind!);
        entity.ParentSetId = payload.ParentSetId;
        entity.CompletedAt = payload.CompletedAt!.Value;
        entity.Rpe = payload.Rpe;
    }

    protected override SetLogPayload CreatePayload(SetLog entity) => new()
    {
        SessionId = entity.SessionId,
        ExerciseId = entity.ExerciseId,
        PlannedExerciseKey = entity.PlannedExerciseKey,
        SetIndex = entity.SetIndex,
        WeightKg = entity.WeightKg,
        Reps = entity.Reps,
        Kind = EnumText.ToText(entity.Kind),
        ParentSetId = entity.ParentSetId,
        CompletedAt = entity.CompletedAt,
        Rpe = entity.Rpe,
    };

    protected override async Task<string?> ValidateReferencesAsync(SetLog entity, Guid userId, CancellationToken cancellationToken)
    {
        if (!await WorkoutReferences.SessionExistsAsync(Db, entity.SessionId, userId, cancellationToken)
            || !await WorkoutReferences.ExerciseExistsAsync(Db, entity.ExerciseId, userId, cancellationToken))
            return SyncErrors.InvalidReference;

        if (entity.ParentSetId is { } parent
            && (parent == entity.Id
                || !await Db.SetLogs.AnyAsync(s => s.Id == parent && s.UserId == userId && s.DeletedAt == null, cancellationToken)))
            return SyncErrors.InvalidReference;

        return null;
    }
}

/// <summary>Syncs <see cref="ExerciseChange"/> as <c>exercise_change</c>.</summary>
public sealed class ExerciseChangeSyncHandler(AppDbContext db, TimeProvider clock)
    : SyncHandler<ExerciseChange, ExerciseChangePayload>(db, clock)
{
    public const string EntityName = "exercise_change";

    private static readonly ExerciseChangePayloadValidator PayloadValidator = new();

    public override string Entity => EntityName;

    protected override IValidator<ExerciseChangePayload> Validator => PayloadValidator;

    protected override ExerciseChange Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    protected override void Apply(ExerciseChangePayload payload, ExerciseChange entity)
    {
        entity.SessionId = payload.SessionId!.Value;
        entity.PlannedExerciseKey = payload.PlannedExerciseKey!;
        entity.Action = EnumText.Parse<ExerciseChangeAction>(payload.Action!);
        entity.ReplacementExerciseId = entity.Action == ExerciseChangeAction.Swapped ? payload.ReplacementExerciseId : null;
        entity.Note = payload.Note;
    }

    protected override ExerciseChangePayload CreatePayload(ExerciseChange entity) => new()
    {
        SessionId = entity.SessionId,
        PlannedExerciseKey = entity.PlannedExerciseKey,
        Action = EnumText.ToText(entity.Action),
        ReplacementExerciseId = entity.ReplacementExerciseId,
        Note = entity.Note,
    };

    protected override async Task<string?> ValidateReferencesAsync(ExerciseChange entity, Guid userId, CancellationToken cancellationToken)
    {
        if (!await WorkoutReferences.SessionExistsAsync(Db, entity.SessionId, userId, cancellationToken))
            return SyncErrors.InvalidReference;

        if (entity.ReplacementExerciseId is { } replacement
            && !await WorkoutReferences.ExerciseExistsAsync(Db, replacement, userId, cancellationToken))
            return SyncErrors.InvalidReference;

        return null;
    }
}

/// <summary>Syncs <see cref="RotationOverride"/> as <c>rotation_override</c>.</summary>
public sealed class RotationOverrideSyncHandler(AppDbContext db, TimeProvider clock)
    : SyncHandler<RotationOverride, RotationOverridePayload>(db, clock)
{
    public const string EntityName = "rotation_override";

    private static readonly RotationOverridePayloadValidator PayloadValidator = new();

    public override string Entity => EntityName;

    protected override IValidator<RotationOverridePayload> Validator => PayloadValidator;

    protected override RotationOverride Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    protected override void Apply(RotationOverridePayload payload, RotationOverride entity)
    {
        entity.Date = payload.Date!.Value;
        entity.WorkoutDayKey = payload.WorkoutDayKey!;
    }

    protected override RotationOverridePayload CreatePayload(RotationOverride entity) => new()
    {
        Date = entity.Date,
        WorkoutDayKey = entity.WorkoutDayKey,
    };

    // Same rule as daily_checkin: a different id for a date that already has a live override is refused.
    protected override async Task<string?> FindConflictAsync(RotationOverride entity, CancellationToken cancellationToken) =>
        await Db.RotationOverrides.AnyAsync(
            o => o.UserId == entity.UserId && o.Date == entity.Date && o.DeletedAt == null && o.Id != entity.Id,
            cancellationToken)
            ? SyncErrors.DateConflict
            : null;
}

internal static class WorkoutReferences
{
    public static Task<bool> SessionExistsAsync(AppDbContext db, Guid id, Guid userId, CancellationToken ct) =>
        db.WorkoutSessions.AnyAsync(s => s.Id == id && s.UserId == userId && s.DeletedAt == null, ct);

    public static Task<bool> ExerciseExistsAsync(AppDbContext db, Guid id, Guid userId, CancellationToken ct) =>
        db.Exercises.AnyAsync(e => e.Id == id && e.UserId == userId && e.DeletedAt == null, ct);
}
