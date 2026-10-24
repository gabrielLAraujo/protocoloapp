namespace ProtocoloApp.Api.Features.Integrations.Matching;

/// <summary>An exercise of the user, as the matcher sees it.</summary>
public sealed record UserExerciseRef(Guid Id, string Name, string[] Aliases, string? CatalogId);

/// <summary>
/// Exact matching of a Hevy exercise title against the user's exercises (spec "Hevy", section 4). No fuzzy: an uncertain
/// title is left for the user to confirm (the device suggests one with <c>matchExercise</c>).
/// <list type="number">
/// <item>A user exercise whose name or alias has the same <see cref="ExerciseWords.Key"/> as the title.</item>
/// <item>A dictionary entry with that key, then the user exercise with the entry's <c>catalogId</c> or, failing that,
/// with a name or alias equal (by key) to one of the entry's names.</item>
/// </list>
/// In the dictionary index a name or alias without equipment also counts with the entry's own equipment
/// ("Leg Press (Machine)" finds the machine entry's "leg press"). Plain keys win over those extended keys; the first
/// entry wins a tie, as on the device.
/// </summary>
public static class HevyExerciseMatcher
{
    private static readonly Lazy<Dictionary<string, DictionaryEntry>> Index = new(BuildIndex);

    public static Guid? Match(string hevyTitle, IReadOnlyList<UserExerciseRef> user)
    {
        var key = ExerciseWords.FromHevyTitle(hevyTitle);
        if (key.Length == 0)
            return null;

        foreach (var exercise in user)
        {
            if (Names(exercise.Name, exercise.Aliases).Any(n => ExerciseWords.Key(n) == key))
                return exercise.Id;
        }

        if (!Index.Value.TryGetValue(key, out var entry))
            return null;

        if (entry.CatalogId is not null)
        {
            foreach (var exercise in user)
            {
                if (string.Equals(exercise.CatalogId, entry.CatalogId, StringComparison.Ordinal))
                    return exercise.Id;
            }
        }

        var entryKeys = Names(entry.Name, entry.Aliases)
            .Select(ExerciseWords.Key)
            .Where(k => k.Length > 0)
            .ToHashSet(StringComparer.Ordinal);
        foreach (var exercise in user)
        {
            if (Names(exercise.Name, exercise.Aliases).Any(n => entryKeys.Contains(ExerciseWords.Key(n))))
                return exercise.Id;
        }

        return null;
    }

    private static IEnumerable<string> Names(string name, string[] aliases) => aliases.Prepend(name);

    private static Dictionary<string, DictionaryEntry> BuildIndex()
    {
        var exact = new Dictionary<string, DictionaryEntry>(StringComparer.Ordinal);
        var extended = new List<(string Key, DictionaryEntry Entry)>();
        foreach (var entry in ExerciseDictionary.Entries)
        {
            var token = ExerciseWords.EquipmentToken(entry.Equipment);
            foreach (var name in Names(entry.Name, entry.Aliases))
            {
                var (core, equipment) = ExerciseWords.Words(name);
                var key = ExerciseWords.KeyOf(core, equipment);
                if (key.Length > 0)
                    exact.TryAdd(key, entry);
                if (token is not null && equipment.Count == 0 && core.Count > 0)
                    extended.Add((ExerciseWords.KeyOf(core, [token]), entry));
            }
        }
        foreach (var (key, entry) in extended)
            exact.TryAdd(key, entry);
        return exact;
    }
}
