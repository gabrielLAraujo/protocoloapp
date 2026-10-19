using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Workouts;

public enum SetKind
{
    Normal,
    Drop,
    Partial,
    RestPause,
    Warmup,
}

/// <summary>One logged set of a <see cref="WorkoutSession"/>.</summary>
public sealed class SetLog : ISyncEntity
{
    public const int MaxSetIndex = 50;
    public const int MaxWeightKg = 1000;
    public const int MaxReps = 200;

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public Guid SessionId { get; set; }

    public Guid ExerciseId { get; set; }

    /// <summary>Key of the planned exercise in the plan document, when the set came from the plan.</summary>
    public string? PlannedExerciseKey { get; set; }

    public int SetIndex { get; set; }

    /// <summary>Kilograms, 0–1000, two decimals.</summary>
    public decimal WeightKg { get; set; }

    /// <summary>0–200.</summary>
    public int Reps { get; set; }

    public SetKind Kind { get; set; }

    /// <summary>For drop / rest-pause sets: the set they continue.</summary>
    public Guid? ParentSetId { get; set; }

    public DateTimeOffset CompletedAt { get; set; }
}
