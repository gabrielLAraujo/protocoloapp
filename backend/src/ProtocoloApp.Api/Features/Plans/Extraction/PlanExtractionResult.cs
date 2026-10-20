using System.Text.Json;

namespace ProtocoloApp.Api.Features.Plans.Extraction;

/// <summary>An exercise of the user's catalog, as the extraction and the draft linking see it.</summary>
public sealed record ExerciseHint(Guid Id, string Name, MuscleGroup Group, IReadOnlyList<string>? Aliases = null);

/// <summary>A planned exercise the user does not have yet; <c>CatalogId</c> (optional) links the media at activation.</summary>
public sealed record NewExerciseSuggestion(string Name, MuscleGroup Group, string? CatalogId = null);

/// <summary>
/// Outcome of an extraction. On success <c>Document</c> is the validated plan document (normalized), <c>Raw</c> the model's
/// whole tool input; on failure only <c>Error</c> (<c>invalid_extraction</c> | <c>timeout</c> | <c>unavailable</c> | <c>no_credits</c> | <c>too_large</c> | <c>too_long</c>) is set.
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

    /// <summary>The provider account has no credits: nothing to retry until someone tops it up.</summary>
    public const string NoCredits = "no_credits";

    public bool IsSuccess => Error is null && Document is not null;

    public static PlanExtractionResult Failure(string error) => new(null, null, [], [], error);
}
