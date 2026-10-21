using System.Text.Json;
using System.Text.RegularExpressions;

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

    /// <summary>Structured techniques (null in documents that predate them); free text that is left stays in <see cref="Technique"/>.</summary>
    public IReadOnlyList<TechniqueDto>? Techniques { get; init; }

    /// <summary>Key of the exercise this one is combined with (bi-set).</summary>
    public string? SupersetWith { get; init; }

    /// <summary>Item of the exercise catalog (media) the device matched for this exercise; activation links it to an exercise that has none. Dropped when it is not in the catalog.</summary>
    public string? CatalogId { get; init; }

    /// <summary>True when the user picked this exercise in the review: activation then keeps the PDF name as an alias of it. Never set by an automatic match.</summary>
    public bool? AliasConfirmed { get; init; }

    /// <summary>True when the user picked <see cref="CatalogId"/> by hand in the review for an exercise they already have: activation then replaces the exercise's own link with it instead of only filling a missing one.</summary>
    public bool? CatalogConfirmed { get; init; }
}

/// <summary>
/// A structured technique of an exercise, discriminated by <c>Type</c> (see <see cref="TechniqueTypes"/>); only the fields of
/// that type are used: drop (<c>Count</c> 1–5, <c>Sets</c>: "last" | "all" | array of 0-based set indexes, optional
/// <c>Percent</c> 1–50), rest_pause (<c>Count</c> 1–5), biset (<c>With</c>: key of another exercise of the same day), sst
/// (<c>Rests</c> in seconds), peak (<c>Seconds</c> 1–10), isometric (<c>Seconds</c> 1–120), partials (optional <c>Reps</c>:
/// an integer 1–30), zero_point (<c>Seconds</c> 1–10), progressive_load, stretch_interval, eccentric (<c>Seconds</c> 1–15),
/// cluster (<c>Reps</c>: array of 1–8 integers 1–30, <c>RestSeconds</c> 5–120), fst7 (optional <c>RestSeconds</c> 5–120),
/// tempo (<c>Text</c> like "3:2" or "3:1:2") and to_failure. A flat record keeps reading tolerant: an unknown <c>Type</c> is
/// reported by <see cref="WorkoutDocumentValidator"/> under <c>...techniques[i].type</c> instead of failing the whole read.
/// </summary>
public sealed record TechniqueDto
{
    public string Type { get; init; } = "";

    public int? Count { get; init; }

    public JsonElement? Sets { get; init; }

    public string? With { get; init; }

    public IReadOnlyList<int>? Rests { get; init; }

    public int? Seconds { get; init; }

    /// <summary>partials: an integer (1–30); cluster: an array of 1–8 integers (1–30). Read as JSON for that reason.</summary>
    public JsonElement? Reps { get; init; }

    public int? RestSeconds { get; init; }

    public string? Text { get; init; }

    public int? Percent { get; init; }
}

/// <summary>Reads the JSON-typed fields of a <see cref="TechniqueDto"/>.</summary>
public static partial class TechniqueValues
{
    /// <summary>True for a tempo text such as "3:2" or "3:1:2" (see <see cref="TechniqueTypes.TempoPattern"/>).</summary>
    public static bool IsTempo(string? text) => text is not null && TempoRegex().IsMatch(text);

    [GeneratedRegex(@"^[0-9]{1,2}:[0-9]{1,2}(:[0-9]{1,2})?\z", RegexOptions.CultureInvariant)]
    private static partial Regex TempoRegex();

    /// <summary>True when <paramref name="value"/> carries something (JSON null counts as missing).</summary>
    public static bool IsPresent(JsonElement? value) => value is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) };

    /// <summary>The value as a single integer, or null when it is missing or not one.</summary>
    public static int? AsInt(JsonElement? value) => value is { ValueKind: JsonValueKind.Number } n && n.TryGetInt32(out var i) ? i : null;

    /// <summary>The value as a list of integers, or null when it is missing or not an array of integers.</summary>
    public static IReadOnlyList<int>? AsIntList(JsonElement? value) =>
        value is { ValueKind: JsonValueKind.Array } array && array.EnumerateArray().All(e => e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out _))
            ? array.EnumerateArray().Select(e => e.GetInt32()).ToList()
            : null;
}

/// <summary>The <see cref="TechniqueDto.Type"/> values.</summary>
public static class TechniqueTypes
{
    public const string Drop = "drop";
    public const string RestPause = "rest_pause";
    public const string Biset = "biset";
    public const string Sst = "sst";
    public const string Peak = "peak";
    public const string Isometric = "isometric";
    public const string Partials = "partials";
    public const string ZeroPoint = "zero_point";
    public const string ProgressiveLoad = "progressive_load";
    public const string StretchInterval = "stretch_interval";
    public const string Eccentric = "eccentric";
    public const string Cluster = "cluster";
    public const string Fst7 = "fst7";
    public const string Tempo = "tempo";
    public const string ToFailure = "to_failure";

    public static readonly string[] All = [Drop, RestPause, Biset, Sst, Peak, Isometric, Partials, ZeroPoint, ProgressiveLoad, StretchInterval, Eccentric, Cluster, Fst7, Tempo, ToFailure];

    /// <summary>The <c>Text</c> of a tempo: "3:2" or "3:1:2" (seconds per phase).</summary>
    public const string TempoPattern = "^[0-9]{1,2}:[0-9]{1,2}(:[0-9]{1,2})?$";
}

public sealed record PlannedSetDto
{
    public int RepsMin { get; init; }

    public int RepsMax { get; init; }

    public string? Technique { get; init; }

    /// <summary>Drop sub-sets after this set (0–5).</summary>
    public int? Drops { get; init; }

    /// <summary>Rest-pause sub-sets after this set (0–5).</summary>
    public int? RestPause { get; init; }
}
