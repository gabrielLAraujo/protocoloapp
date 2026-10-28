using System.Text.Json;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Workouts;

/// <summary>Where a session was recorded: in the app, or imported from Hevy by the server.</summary>
public enum SessionSource
{
    App,
    Hevy,
}

/// <summary>One workout the user did (or is doing) on a date, following a day of a plan version.</summary>
public sealed class WorkoutSession : ISyncEntity
{
    public const int MaxKeyLength = 64;
    public const int MaxNoteLength = 2000;
    public const int MaxExerciseNotes = 30;
    public const int MaxExternalIdLength = 64;
    public const int MaxExternalTitleLength = 200;

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public DateOnly Date { get; set; }

    /// <summary>The plan version the session followed (it may be archived later; sessions keep pointing at it).</summary>
    public Guid PlanVersionId { get; set; }

    public string WorkoutDayKey { get; set; } = "";

    public DateTimeOffset StartedAt { get; set; }

    public DateTimeOffset? EndedAt { get; set; }

    public string? Note { get; set; }

    /// <summary>Per-exercise notes: a JSON object <c>planned_exercise_key -> text</c>, column <c>exercise_notes</c> (<c>jsonb</c>). Null when there are none.</summary>
    public JsonDocument? ExerciseNotes { get; set; }

    /// <summary>Set by the server (<c>app</c> unless imported); a push never changes it.</summary>
    public SessionSource Source { get; set; }

    /// <summary>The id of the workout in the external source (Hevy); unique per user and source, deleted rows included.</summary>
    public string? ExternalId { get; set; }

    /// <summary>The external workout's <c>updated_at</c> at the last import (server only).</summary>
    public DateTimeOffset? ExternalUpdatedAt { get; set; }

    /// <summary>The external workout's title (pull only; a push never changes it).</summary>
    public string? ExternalTitle { get; set; }
}
