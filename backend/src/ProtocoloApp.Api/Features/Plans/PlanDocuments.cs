using System.Text.Json;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>
/// The typed documents stored in <c>plan_versions.document</c> (spec 3.3): camelCase JSON, read leniently (a missing list is
/// empty, unknown properties are ignored) and checked by <see cref="ProtocolDocumentValidator"/> and
/// <see cref="WorkoutDocumentValidator"/>.
/// </summary>
public static class PlanDocuments
{
    public static JsonSerializerOptions Options { get; } = new(JsonSerializerDefaults.Web);

    public static T? Deserialize<T>(string json) where T : class => JsonSerializer.Deserialize<T>(json, Options);

    public static T? Deserialize<T>(JsonElement json) where T : class => json.Deserialize<T>(Options);

    /// <summary>
    /// Reads and deserializes a document. Malformed JSON, wrong types (<c>"repsMin": null</c>) and a non-object root come back
    /// as <paramref name="errors"/> (JSON path of the problem when known), never as an exception.
    /// </summary>
    public static bool TryRead<T>(JsonElement json, out T? document, out IReadOnlyList<string> errors) where T : class
    {
        document = null;
        if (json.ValueKind != JsonValueKind.Object)
        {
            errors = ["document"];
            return false;
        }

        try
        {
            document = json.Deserialize<T>(Options);
        }
        catch (JsonException ex)
        {
            errors = [ex.Path is { Length: > 2 } path && path.StartsWith("$.", StringComparison.Ordinal) ? path[2..] : "document"];
            return false;
        }

        errors = document is null ? ["document"] : [];
        return document is not null;
    }

    public static JsonElement Serialize<T>(T document) => JsonSerializer.SerializeToElement(document, Options);
}

/// <summary>Document of a <see cref="PlanKind.Protocol"/> version. <c>UpdateDate</c> may be null (the PDF does not always carry it).</summary>
public sealed record ProtocolDocument
{
    public string? PhaseName { get; init; }

    public DateOnly? UpdateDate { get; init; }

    public DateOnly? BillingDate { get; init; }

    public IReadOnlyList<MealDto> Meals { get; init; } = [];

    public IReadOnlyList<ProtocolItemDto> Items { get; init; } = [];

    public CardioPlanDto? Cardio { get; init; }

    public IReadOnlyList<GuidelineDto> Guidelines { get; init; } = [];

    public string? TrainingSplitNote { get; init; }
}

public sealed record MealDto
{
    public string Key { get; init; } = "";

    public string Label { get; init; } = "";

    public IReadOnlyList<MealItemDto> Items { get; init; } = [];

    public string? Notes { get; init; }
}

public sealed record MealItemDto
{
    public string Food { get; init; } = "";

    public decimal? Grams { get; init; }

    public IReadOnlyList<string> Alternatives { get; init; } = [];
}

/// <summary><c>Category</c>: supplement|compound|hormone|thermogenic|sleep_optional. <c>Timing</c>: any|fasting|after_meal|before_bed|pre_workout|intra_workout|post_workout|with_meal:&lt;slot&gt;.</summary>
public sealed record ProtocolItemDto
{
    public string Key { get; init; } = "";

    public string Category { get; init; } = "";

    public string Name { get; init; } = "";

    public string? DoseText { get; init; }

    public string Timing { get; init; } = "any";

    public ScheduleDto Schedule { get; init; } = new();
}

/// <summary>Schedule rule (general spec 4.2): daily | weekdays (<c>Days</c>) | every_n_days (<c>N</c>, <c>Anchor</c>) | training_days_only | off_days_only.</summary>
public sealed record ScheduleDto
{
    public string Type { get; init; } = "daily";

    public IReadOnlyList<string>? Days { get; init; }

    public int? N { get; init; }

    public DateOnly? Anchor { get; init; }
}

public sealed record CardioPlanDto
{
    public int? SessionsPerWeek { get; init; }

    public bool? Daily { get; init; }

    public int? DurationMin { get; init; }

    public string? Intensity { get; init; }

    public string? PreferredTime { get; init; }
}

/// <summary><c>Kind</c>: water_min_l|free_meals_per_week (<c>Value</c>) | text (<c>Text</c>).</summary>
public sealed record GuidelineDto
{
    public string Kind { get; init; } = "";

    public decimal? Value { get; init; }

    public string? Text { get; init; }
}

/// <summary>Document of a <see cref="PlanKind.Workout"/> version.</summary>
public sealed record WorkoutDocument
{
    public RotationDto? Rotation { get; init; }

    public IReadOnlyList<WorkoutDayDto> Days { get; init; } = [];
}

/// <summary><c>Type</c> = sequence (<c>Items</c>, optional <c>Anchor</c>) | fixed_weekdays (<c>Map</c> of mon..sun). <c>off</c> is a rest day.</summary>
public sealed record RotationDto
{
    public const string Off = "off";
    public const string Sequence = "sequence";
    public const string FixedWeekdays = "fixed_weekdays";

    public string Type { get; init; } = "";

    public IReadOnlyList<string>? Items { get; init; }

    public DateOnly? Anchor { get; init; }

    public IReadOnlyDictionary<string, string>? Map { get; init; }
}

public sealed record WorkoutDayDto
{
    public string Key { get; init; } = "";

    public string Name { get; init; } = "";

    public string? Notes { get; init; }

    public IReadOnlyList<PlannedExerciseDto> Exercises { get; init; } = [];
}

public sealed record PlannedExerciseDto
{
    public string Key { get; init; } = "";

    public Guid? ExerciseId { get; init; }

    public string Name { get; init; } = "";

    public IReadOnlyList<PlannedSetDto> Sets { get; init; } = [];

    public int? RestSeconds { get; init; }

    public IReadOnlyList<int>? RestSequence { get; init; }

    public string? Technique { get; init; }

    /// <summary>Key of the exercise this one is combined with (bi-set).</summary>
    public string? SupersetWith { get; init; }
}

public sealed record PlannedSetDto
{
    public int RepsMin { get; init; }

    public int RepsMax { get; init; }

    public string? Technique { get; init; }
}
