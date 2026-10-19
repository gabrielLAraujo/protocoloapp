using System.Text.Json;

namespace ProtocoloApp.Api.Features.Plans.Extraction;

public sealed record ExerciseHint(Guid Id, string Name, MuscleGroup Group);

public sealed record NewExerciseSuggestion(string Name, MuscleGroup Group);

/// <summary>
/// Outcome of an extraction. On success <c>Document</c> is the validated plan document (normalized), <c>Raw</c> the model's
/// whole tool input; on failure only <c>Error</c> (<c>invalid_extraction</c> | <c>timeout</c> | <c>unavailable</c>) is set.
/// </summary>
public sealed record PlanExtractionResult(
    JsonDocument? Document,
    JsonDocument? Raw,
    IReadOnlyList<string> LowConfidence,
    IReadOnlyList<NewExerciseSuggestion> NewExercises,
    string? Error)
{
    public const string InvalidExtraction = "invalid_extraction";
    public const string Timeout = "timeout";
    public const string Unavailable = "unavailable";
    public const string TooLarge = "too_large";
    public const string TooLong = "too_long";

    public bool IsSuccess => Error is null && Document is not null;

    public static PlanExtractionResult Failure(string error) => new(null, null, [], [], error);
}
