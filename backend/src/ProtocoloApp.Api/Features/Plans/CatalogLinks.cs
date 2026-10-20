using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.ExerciseCatalog;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>
/// Catalog links in a draft are hints: the catalog is refreshed from outside, so a link to an item that is gone is dropped
/// (never an error), both when the draft is written and when it is activated.
/// </summary>
internal static class CatalogLinks
{
    public static async Task<HashSet<string>> ExistingAsync(AppDbContext db, IEnumerable<string?> ids, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(ids);

        var wanted = ids.Where(id => id is not null && id.Length <= CatalogExercise.MaxIdLength).Select(id => id!).Distinct(StringComparer.Ordinal).ToList();
        var found = new HashSet<string>(StringComparer.Ordinal);
        if (wanted.Count > 0)
            found.UnionWith(await db.CatalogExercises.Where(c => wanted.Contains(c.Id)).Select(c => c.Id).ToListAsync(ct));
        return found;
    }

    public static async Task<IReadOnlyList<NewExerciseSuggestion>> CleanAsync(AppDbContext db, IReadOnlyList<NewExerciseSuggestion> suggestions, CancellationToken ct)
    {
        var found = await ExistingAsync(db, suggestions.Select(s => s.CatalogId), ct);
        return [.. suggestions.Select(s => s.CatalogId is not null && !found.Contains(s.CatalogId) ? s with { CatalogId = null } : s)];
    }

    public static async Task<WorkoutDocument> CleanAsync(AppDbContext db, WorkoutDocument workout, CancellationToken ct)
    {
        var found = await ExistingAsync(db, (workout.Days ?? []).SelectMany(d => d?.Exercises ?? []).Select(e => e?.CatalogId), ct);
        return workout with
        {
            Days = [.. (workout.Days ?? []).Select(day => day is null ? day! : day with
            {
                Exercises = [.. (day.Exercises ?? []).Select(e => e?.CatalogId is { } id && !found.Contains(id) ? e with { CatalogId = null } : e!)],
            })],
        };
    }
}
