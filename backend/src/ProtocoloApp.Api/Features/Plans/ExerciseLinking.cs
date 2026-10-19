using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>
/// What every way of building a draft (AI extraction, the on-device reader) does the same: link the exercises of a workout
/// to the user's catalog by normalized name or alias, drop suggested new exercises the catalog already has, and keep only
/// low-confidence paths that exist in the document.
/// </summary>
internal static class ExerciseLinking
{
    /// <summary>The user's live catalog, as hints for linking (and for the extraction prompt).</summary>
    public static async Task<IReadOnlyList<ExerciseHint>> LoadHintsAsync(AppDbContext db, Guid userId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);

        return (await db.Exercises.AsNoTracking()
                .Where(e => e.UserId == userId && e.DeletedAt == null)
                .Select(e => new { e.Id, e.Name, e.PrimaryMuscleGroup, e.Aliases })
                .ToListAsync(ct))
            .Select(e => new ExerciseHint(e.Id, e.Name, e.PrimaryMuscleGroup, e.Aliases))
            .ToList();
    }

    /// <summary>
    /// Keeps only exercise ids the user's catalog has (an unknown id becomes null and low confidence) and fills the id of an
    /// exercise whose normalized name matches a known name, or else a known alias.
    /// </summary>
    public static WorkoutDocument LinkExercises(WorkoutDocument workout, IReadOnlyList<ExerciseHint> known, List<string> lowConfidence)
    {
        ArgumentNullException.ThrowIfNull(workout);
        ArgumentNullException.ThrowIfNull(known);
        ArgumentNullException.ThrowIfNull(lowConfidence);

        var byId = known.Select(k => k.Id).ToHashSet();
        var byName = new Dictionary<string, Guid>(StringComparer.Ordinal);
        foreach (var hint in known)
            byName.TryAdd(ExerciseNames.Normalize(hint.Name), hint.Id);
        var byAlias = new Dictionary<string, Guid>(StringComparer.Ordinal);
        foreach (var hint in known)
        {
            foreach (var alias in hint.Aliases ?? [])
                byAlias.TryAdd(ExerciseNames.Normalize(alias), hint.Id);
        }

        var days = (workout.Days ?? []).Select((day, i) => day is null ? day! : day with
        {
            Exercises = (day.Exercises ?? []).Select((exercise, j) =>
            {
                if (exercise is null)
                    return exercise!; // kept as is: the validator reports the null element

                var id = exercise.ExerciseId;
                if (id is { } given && !byId.Contains(given))
                {
                    id = null;
                    lowConfidence.Add($"days[{i}].exercises[{j}].exerciseId");
                }

                if (id is null && !string.IsNullOrWhiteSpace(exercise.Name))
                {
                    var normalized = ExerciseNames.Normalize(exercise.Name);
                    if (byName.TryGetValue(normalized, out var match) || byAlias.TryGetValue(normalized, out match))
                        id = match;
                }

                return exercise with { ExerciseId = id };
            }).ToList(),
        }).ToList();

        return workout with { Days = days };
    }

    /// <summary>
    /// The suggestions worth keeping: a usable name (trimmed) that is neither a known exercise (name or alias) nor a repeat of
    /// an earlier suggestion.
    /// </summary>
    public static IEnumerable<NewExerciseSuggestion> WithoutKnown(IEnumerable<NewExerciseSuggestion> suggestions, IReadOnlyList<ExerciseHint> known)
    {
        ArgumentNullException.ThrowIfNull(suggestions);
        ArgumentNullException.ThrowIfNull(known);

        var skip = known.Select(k => ExerciseNames.Normalize(k.Name))
            .Concat(known.SelectMany(k => k.Aliases ?? Array.Empty<string>()).Select(ExerciseNames.Normalize))
            .ToHashSet(StringComparer.Ordinal);
        foreach (var suggestion in suggestions)
        {
            var name = suggestion.Name.Trim();
            var normalized = ExerciseNames.Normalize(name);
            if (!ExerciseNames.IsUsable(normalized) || !skip.Add(normalized))
                continue;

            yield return suggestion with { Name = name };
        }
    }

    /// <summary>Trimmed paths without a <c>$.</c>/<c>document.</c> prefix, deduped, that resolve in <paramref name="document"/>.</summary>
    public static IReadOnlyList<string> CleanLowConfidence(IEnumerable<string?> paths, JsonElement document)
    {
        ArgumentNullException.ThrowIfNull(paths);

        return paths
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => StripPrefix(p!))
            .Distinct(StringComparer.Ordinal)
            .Where(path => Resolves(document, path))
            .ToList();
    }

    private static string StripPrefix(string path)
    {
        path = path.Trim();
        foreach (var prefix in new[] { "$.", "document." })
        {
            if (path.StartsWith(prefix, StringComparison.Ordinal))
                return path[prefix.Length..];
        }

        return path;
    }

    /// <summary>Whether a path such as <c>days[0].exercises[1].sets</c> exists in the document (a property with a null value exists).</summary>
    internal static bool Resolves(JsonElement root, string path)
    {
        var node = root;
        foreach (var segment in path.Split('.'))
        {
            var bracket = segment.IndexOf('[', StringComparison.Ordinal);
            var name = bracket < 0 ? segment : segment[..bracket];
            if (name.Length > 0 && (node.ValueKind != JsonValueKind.Object || !node.TryGetProperty(name, out node)))
                return false;

            var rest = bracket < 0 ? "" : segment[bracket..];
            while (rest.Length > 0)
            {
                var close = rest.IndexOf(']', StringComparison.Ordinal);
                if (rest[0] != '[' || close < 2 || !int.TryParse(rest[1..close], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var index)
                    || node.ValueKind != JsonValueKind.Array || index >= node.GetArrayLength())
                {
                    return false;
                }

                node = node[index];
                rest = rest[(close + 1)..];
            }
        }

        return path.Length > 0;
    }
}
