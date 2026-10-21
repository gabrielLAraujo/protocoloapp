using System.Text.Json;

namespace ProtocoloApp.Api.Features.Plans.Extraction;

/// <summary>
/// Repairs or drops the structured techniques of an AI draft so that one bad technique never fails the whole extraction:
/// unknown types, impossible references and out-of-range numbers are fixed or removed before the document is validated.
/// </summary>
internal static class TechniqueSanitizer
{
    public static WorkoutDocument Sanitize(WorkoutDocument doc)
    {
        var days = (doc.Days ?? []).Select(day => day is null ? day! : day with { Exercises = SanitizeDay(day) }).ToList();
        return doc with { Days = days };
    }

    private static IReadOnlyList<PlannedExerciseDto> SanitizeDay(WorkoutDayDto day)
    {
        var exercises = day.Exercises ?? [];
        return exercises.Select(e => e is null ? e! : SanitizeExercise(e, exercises)).ToList();
    }

    private static PlannedExerciseDto SanitizeExercise(PlannedExerciseDto exercise, IReadOnlyList<PlannedExerciseDto> day)
    {
        var sets = (exercise.Sets ?? []).Select(s => s is null ? s! : s with { Drops = Clamp(s.Drops, 0, 5), RestPause = Clamp(s.RestPause, 0, 5) }).ToList();
        var kept = new List<TechniqueDto>();
        foreach (var technique in exercise.Techniques ?? [])
        {
            if (Repair(technique, exercise, day, sets.Count) is { } repaired)
                kept.Add(repaired);
        }

        return exercise with { Sets = sets, Techniques = exercise.Techniques is null ? null : kept };
    }

    private static int? Clamp(int? value, int min, int max) => value is { } v ? Math.Clamp(v, min, max) : null;

    private static TechniqueDto? Repair(TechniqueDto? t, PlannedExerciseDto exercise, IReadOnlyList<PlannedExerciseDto> day, int setCount)
    {
        if (t is null)
            return null;

        switch (t.Type)
        {
            case TechniqueTypes.Drop:
                return t with { Count = Math.Clamp(t.Count ?? 1, 1, 5), Sets = RepairDropSets(t.Sets, setCount), Percent = t.Percent is >= 1 and <= 50 ? t.Percent : null };
            case TechniqueTypes.RestPause:
                return t with { Count = Math.Clamp(t.Count ?? 1, 1, 5) };
            case TechniqueTypes.Biset:
                return !string.IsNullOrWhiteSpace(t.With) && t.With != exercise.Key && day.Any(e => e is not null && e.Key == t.With) ? t : null;
            case TechniqueTypes.Sst:
                return t.Rests is { Count: > 0 } rests ? t with { Rests = rests.Select(r => Math.Clamp(r, 0, PlanDocumentRules.MaxRestSeconds)).ToList() } : null;
            case TechniqueTypes.Peak:
            case TechniqueTypes.ZeroPoint:
                return t.Seconds is { } s1 ? t with { Seconds = Math.Clamp(s1, 1, 10) } : null;
            case TechniqueTypes.Isometric:
                return t.Seconds is { } s2 ? t with { Seconds = Math.Clamp(s2, 1, 120) } : null;
            case TechniqueTypes.Partials:
                return t with { Reps = TechniqueValues.AsInt(t.Reps) is >= 1 and <= 30 ? t.Reps : null };
            case TechniqueTypes.Eccentric:
                return t.Seconds is { } s3 ? t with { Seconds = Math.Clamp(s3, 1, 15) } : null;
            case TechniqueTypes.Cluster:
                return TechniqueValues.AsIntList(t.Reps) is { Count: > 0 } miniSets && t.RestSeconds is { } pause
                    ? t with { Reps = JsonSerializer.SerializeToElement(miniSets.Take(8).Select(r => Math.Clamp(r, 1, 30)).ToList()), RestSeconds = Math.Clamp(pause, 5, 120) }
                    : null;
            case TechniqueTypes.Fst7:
                return t with { RestSeconds = t.RestSeconds is { } fstRest ? Math.Clamp(fstRest, 5, 120) : null };
            case TechniqueTypes.Tempo:
                var tempo = t.Text?.Replace(" ", "", StringComparison.Ordinal);
                return TechniqueValues.IsTempo(tempo) ? t with { Text = tempo } : null;
            case TechniqueTypes.ProgressiveLoad:
            case TechniqueTypes.StretchInterval:
            case TechniqueTypes.ToFailure:
                return t;
            default:
                return null;
        }
    }

    private static JsonElement RepairDropSets(JsonElement? sets, int setCount)
    {
        if (sets is { ValueKind: JsonValueKind.String } text && text.GetString() is "last" or "all")
            return sets.Value;
        if (sets is { ValueKind: JsonValueKind.Array } array)
        {
            var indexes = array.EnumerateArray()
                .Where(e => e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var i) && i >= 0 && i < setCount)
                .Select(e => e.GetInt32())
                .Distinct()
                .ToList();
            if (indexes.Count > 0)
                return JsonSerializer.SerializeToElement(indexes);
        }

        return JsonSerializer.SerializeToElement("last");
    }
}
