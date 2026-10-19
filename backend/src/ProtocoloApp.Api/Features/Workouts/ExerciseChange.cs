using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Workouts;

public enum ExerciseChangeAction
{
    Swapped,
    Skipped,
}

/// <summary>A deviation from the plan inside a session: a planned exercise swapped for another or skipped.</summary>
public sealed class ExerciseChange : ISyncEntity
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public Guid SessionId { get; set; }

    public string PlannedExerciseKey { get; set; } = "";

    public ExerciseChangeAction Action { get; set; }

    /// <summary>Required when swapped; null when skipped.</summary>
    public Guid? ReplacementExerciseId { get; set; }

    public string? Note { get; set; }
}
