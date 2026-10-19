using System.Text.Json;
using ProtocoloApp.Api.Features.Plans.Extraction;

namespace ProtocoloApp.Api.Features.Plans;

public sealed record ImportPlanRequest(Guid FileId, PlanKind Kind);

public sealed record UpdatePlanRequest(JsonElement Document, IReadOnlyList<NewExerciseSuggestion>? NewExercises);

public sealed record ActivatePlanRequest(DateOnly? CycleStart);

public sealed record PlanVersionResponse(
    Guid Id,
    PlanKind Kind,
    PlanStatus Status,
    JsonElement Document,
    IReadOnlyList<string> LowConfidence,
    string? ExtractionError,
    IReadOnlyList<NewExerciseSuggestion> NewExercises,
    PlanDiffDto? Diff,
    DateTimeOffset? ActivatedAt,
    Guid SourceFileId);

public sealed record PlanVersionSummary(
    Guid Id,
    PlanKind Kind,
    PlanStatus Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ActivatedAt,
    Guid SourceFileId,
    string? ExtractionError);

public sealed record ExerciseResponse(Guid Id, string Name, MuscleGroup Group, IReadOnlyList<string> Aliases);

public sealed record UpdateExerciseRequest(MuscleGroup Group, string[] Aliases);

/// <summary>Mapping between rows and contracts, including the draft's pending new exercises.</summary>
internal static class PlanMapping
{
    public static PlanVersionResponse ToResponse(PlanVersion plan, PlanDiffDto? diff) => new(
        plan.Id,
        plan.Kind,
        plan.Status,
        plan.Document.RootElement.Clone(),
        plan.LowConfidence,
        plan.ExtractionError,
        ReadNewExercises(plan.NewExercises),
        diff,
        plan.ActivatedAt,
        plan.SourceFileId);

    public static ExerciseResponse ToResponse(Exercise exercise) =>
        new(exercise.Id, exercise.Name, exercise.PrimaryMuscleGroup, exercise.Aliases);

    public static IReadOnlyList<NewExerciseSuggestion> ReadNewExercises(JsonDocument? stored)
    {
        if (stored is null || stored.RootElement.ValueKind != JsonValueKind.Array)
            return [];

        var list = new List<NewExerciseSuggestion>();
        foreach (var element in stored.RootElement.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object
                || !element.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String
                || !element.TryGetProperty("group", out var group) || group.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            try
            {
                list.Add(new NewExerciseSuggestion(name.GetString()!, EnumText.Parse<MuscleGroup>(group.GetString()!)));
            }
            catch (FormatException)
            {
            }
        }

        return list;
    }

    /// <summary>Stored as <c>[{"name","group"}]</c> with the group in snake_case; empty list is stored as null. Names are deduped by normalized name.</summary>
    public static JsonDocument? WriteNewExercises(IEnumerable<NewExerciseSuggestion> suggestions)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var rows = suggestions
            .Where(s => seen.Add(ExerciseNames.Normalize(s.Name)))
            .Select(s => new { name = s.Name.Trim(), group = EnumText.ToText(s.Group) })
            .ToList();
        return rows.Count == 0 ? null : JsonSerializer.SerializeToDocument(rows);
    }
}
