using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.ExerciseCatalog;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>
/// Catalog links in a draft are hints: the catalog is refreshed from outside, so a link to an item that is gone is dropped
/// (never an error), both when the draft is written and when it is activated. "Gone" is only known once the catalog was
/// completely synced (<see cref="CatalogState.IsSyncedAsync"/>): before that, a well-formed id is kept as it is, and
/// <see cref="CatalogLinkCleanup"/> clears the ones that turn out not to exist after the sync.
/// </summary>
internal static partial class CatalogLinks
{
    /// <summary>The shape of an id kept while the catalog is not synced yet (ExerciseDB ids are short alphanumeric codes).</summary>
    public static bool IsWellFormed(string? id) =>
        id is { Length: > 0 and <= CatalogExercise.MaxIdLength } && IdPattern().IsMatch(id);

    /// <summary>
    /// The ids among <paramref name="ids"/> a link may keep: the ones in the catalog when it is synced, otherwise the
    /// well-formed ones.
    /// </summary>
    public static async Task<HashSet<string>> KeptAsync(AppDbContext db, IEnumerable<string?> ids, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(ids);

        var wanted = ids
            .Where(id => !string.IsNullOrWhiteSpace(id) && id.Length <= CatalogExercise.MaxIdLength)
            .Select(id => id!)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var kept = new HashSet<string>(StringComparer.Ordinal);
        if (wanted.Count == 0)
            return kept;

        if (!await CatalogState.IsSyncedAsync(db, ct))
        {
            kept.UnionWith(wanted.Where(IsWellFormed));
            return kept;
        }

        kept.UnionWith(await db.CatalogExercises.Where(c => wanted.Contains(c.Id)).Select(c => c.Id).ToListAsync(ct));
        return kept;
    }

    public static async Task<IReadOnlyList<NewExerciseSuggestion>> CleanAsync(AppDbContext db, IReadOnlyList<NewExerciseSuggestion> suggestions, CancellationToken ct)
    {
        var kept = await KeptAsync(db, suggestions.Select(s => s.CatalogId), ct);
        return [.. suggestions.Select(s => s.CatalogId is not null && !kept.Contains(s.CatalogId) ? s with { CatalogId = null } : s)];
    }

    public static async Task<WorkoutDocument> CleanAsync(AppDbContext db, WorkoutDocument workout, CancellationToken ct)
    {
        var kept = await KeptAsync(db, (workout.Days ?? []).SelectMany(d => d?.Exercises ?? []).Select(e => e?.CatalogId), ct);
        return workout with
        {
            Days = [.. (workout.Days ?? []).Select(day => day is null ? day! : day with
            {
                Exercises = [.. (day.Exercises ?? []).Select(e => e?.CatalogId is { } id && !kept.Contains(id) ? e with { CatalogId = null } : e!)],
            })],
        };
    }

    [GeneratedRegex(@"^[A-Za-z0-9_-]+\z", RegexOptions.CultureInvariant)]
    private static partial Regex IdPattern();
}
