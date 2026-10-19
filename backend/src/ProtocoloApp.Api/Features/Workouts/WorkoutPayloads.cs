using FluentValidation;

namespace ProtocoloApp.Api.Features.Workouts;

// Payloads are snake_case JSON like daily_checkin. Every property is nullable so that a missing field is reported as
// invalid_payload:<field> instead of silently becoming a default. Unknown properties are ignored.

/// <summary>
/// <c>workout_session</c>: <c>{date, plan_version_id, workout_day_key, started_at, ended_at?, note?}</c>.
/// <c>plan_version_id</c> must be a (non-deleted) plan version of the user, archived or not.
/// </summary>
public sealed record WorkoutSessionPayload
{
    public DateOnly? Date { get; init; }

    public Guid? PlanVersionId { get; init; }

    public string? WorkoutDayKey { get; init; }

    public DateTimeOffset? StartedAt { get; init; }

    public DateTimeOffset? EndedAt { get; init; }

    public string? Note { get; init; }
}

public sealed class WorkoutSessionPayloadValidator : AbstractValidator<WorkoutSessionPayload>
{
    public WorkoutSessionPayloadValidator()
    {
        RuleFor(p => p.Date).NotNull().OverridePropertyName("date");
        RuleFor(p => p.PlanVersionId).NotNull().NotEqual(Guid.Empty).OverridePropertyName("plan_version_id");
        RuleFor(p => p.WorkoutDayKey).NotEmpty().MaximumLength(WorkoutSession.MaxKeyLength).OverridePropertyName("workout_day_key");
        RuleFor(p => p.StartedAt).NotNull().OverridePropertyName("started_at");
        RuleFor(p => p.EndedAt).Must((p, ended) => ended is null || p.StartedAt is null || ended >= p.StartedAt).OverridePropertyName("ended_at");
        RuleFor(p => p.Note).MaximumLength(WorkoutSession.MaxNoteLength).OverridePropertyName("note");
    }
}

/// <summary>
/// <c>set_log</c>: <c>{session_id, exercise_id, planned_exercise_key?, set_index, weight_kg, reps, kind, parent_set_id?,
/// completed_at}</c>; <c>kind</c> is <c>normal|drop|partial|rest_pause|warmup</c>. The session, exercise and parent set
/// must exist, belong to the user and not be deleted, so a client sends the session before its sets.
/// </summary>
public sealed record SetLogPayload
{
    public Guid? SessionId { get; init; }

    public Guid? ExerciseId { get; init; }

    public string? PlannedExerciseKey { get; init; }

    public int? SetIndex { get; init; }

    public decimal? WeightKg { get; init; }

    public int? Reps { get; init; }

    public string? Kind { get; init; }

    public Guid? ParentSetId { get; init; }

    public DateTimeOffset? CompletedAt { get; init; }
}

public sealed class SetLogPayloadValidator : AbstractValidator<SetLogPayload>
{
    public SetLogPayloadValidator()
    {
        RuleFor(p => p.SessionId).NotNull().NotEqual(Guid.Empty).OverridePropertyName("session_id");
        RuleFor(p => p.ExerciseId).NotNull().NotEqual(Guid.Empty).OverridePropertyName("exercise_id");
        RuleFor(p => p.PlannedExerciseKey).MaximumLength(WorkoutSession.MaxKeyLength).OverridePropertyName("planned_exercise_key");
        RuleFor(p => p.SetIndex).NotNull().InclusiveBetween(0, SetLog.MaxSetIndex).OverridePropertyName("set_index");
        RuleFor(p => p.WeightKg).NotNull().InclusiveBetween(0m, (decimal)SetLog.MaxWeightKg).PrecisionScale(6, 2, true).OverridePropertyName("weight_kg");
        RuleFor(p => p.Reps).NotNull().InclusiveBetween(0, SetLog.MaxReps).OverridePropertyName("reps");
        RuleFor(p => p.Kind).Must(k => k is not null && Plans.EnumText.Values<SetKind>().Contains(k)).OverridePropertyName("kind");
        RuleFor(p => p.ParentSetId).NotEqual(Guid.Empty).OverridePropertyName("parent_set_id");
        RuleFor(p => p.CompletedAt).NotNull().OverridePropertyName("completed_at");
    }
}

/// <summary>
/// <c>exercise_change</c>: <c>{session_id, planned_exercise_key, action, replacement_exercise_id?, note?}</c>;
/// <c>action</c> is <c>swapped|skipped</c> and <c>replacement_exercise_id</c> is required when swapped (ignored when skipped).
/// </summary>
public sealed record ExerciseChangePayload
{
    public Guid? SessionId { get; init; }

    public string? PlannedExerciseKey { get; init; }

    public string? Action { get; init; }

    public Guid? ReplacementExerciseId { get; init; }

    public string? Note { get; init; }
}

public sealed class ExerciseChangePayloadValidator : AbstractValidator<ExerciseChangePayload>
{
    private static readonly IReadOnlyList<string> Actions = Plans.EnumText.Values<ExerciseChangeAction>();

    public ExerciseChangePayloadValidator()
    {
        RuleFor(p => p.SessionId).NotNull().NotEqual(Guid.Empty).OverridePropertyName("session_id");
        RuleFor(p => p.PlannedExerciseKey).NotEmpty().MaximumLength(WorkoutSession.MaxKeyLength).OverridePropertyName("planned_exercise_key");
        RuleFor(p => p.Action).Must(a => a is not null && Actions.Contains(a)).OverridePropertyName("action");
        RuleFor(p => p.ReplacementExerciseId)
            .Must((p, id) => p.Action != Plans.EnumText.ToText(ExerciseChangeAction.Swapped) || (id is not null && id != Guid.Empty))
            .OverridePropertyName("replacement_exercise_id");
        RuleFor(p => p.Note).MaximumLength(WorkoutSession.MaxNoteLength).OverridePropertyName("note");
    }
}

/// <summary><c>rotation_override</c>: <c>{date, workout_day_key}</c>, the key of a workout day or <c>off</c>. One live override per date.</summary>
public sealed record RotationOverridePayload
{
    public DateOnly? Date { get; init; }

    public string? WorkoutDayKey { get; init; }
}

public sealed class RotationOverridePayloadValidator : AbstractValidator<RotationOverridePayload>
{
    public RotationOverridePayloadValidator()
    {
        RuleFor(p => p.Date).NotNull().OverridePropertyName("date");
        RuleFor(p => p.WorkoutDayKey).NotEmpty().MaximumLength(WorkoutSession.MaxKeyLength).OverridePropertyName("workout_day_key");
    }
}
