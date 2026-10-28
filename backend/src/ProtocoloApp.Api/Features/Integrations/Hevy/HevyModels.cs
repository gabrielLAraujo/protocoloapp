namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>A workout as the Hevy public API returns it, with only the fields the importer uses.</summary>
public sealed record HevyWorkout(
    string Id,
    string Title,
    string? Description,
    DateTimeOffset StartTime,
    DateTimeOffset? EndTime,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<HevyExercise> Exercises);

public sealed record HevyExercise(string Title, string TemplateId, int? SupersetId, string? Notes, IReadOnlyList<HevySet> Sets);

/// <summary>Raw values: <c>Type</c> is Hevy's (<c>normal</c>, <c>warmup</c>, <c>dropset</c>, <c>failure</c> or anything new); range checks happen in the mapper.</summary>
public sealed record HevySet(int Index, string Type, decimal? WeightKg, int? Reps, decimal? DistanceMeters, int? DurationSeconds, decimal? Rpe);

/// <summary><c>updated</c> carries <c>Workout</c>; <c>deleted</c> carries <c>DeletedId</c> (and <c>DeletedAt</c> when sent).</summary>
public sealed record HevyEvent(string Type, HevyWorkout? Workout, string? DeletedId, DateTimeOffset? DeletedAt)
{
    public const string Updated = "updated";
    public const string Deleted = "deleted";
}

public sealed record HevyTemplate(string Id, string Title, string? PrimaryMuscleGroup);

/// <summary><c>Skipped</c>: entries of the list that could not be read (only the count is ever logged).</summary>
public sealed record HevyPage<T>(IReadOnlyList<T> Items, int Page, int PageCount, int Skipped);

public enum HevyError
{
    /// <summary>401/403, or a key that cannot be sent as a header.</summary>
    Unauthorized,

    /// <summary>429.</summary>
    RateLimited,

    /// <summary>5xx, 408, timeout or network failure.</summary>
    Unavailable,

    /// <summary>Not JSON, an unexpected envelope, or another unexpected status (3xx, 404...).</summary>
    Format,
}

public sealed record HevyResult<T>(T? Value, HevyError? Error)
{
    public static HevyResult<T> Ok(T value) => new(value, null);

    public static HevyResult<T> Fail(HevyError error) => new(default, error);
}
