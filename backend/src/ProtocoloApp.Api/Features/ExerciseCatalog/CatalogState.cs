using System.Globalization;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.ExerciseCatalog;

/// <summary>Whether the server's copy of the catalog can be trusted to say that an id does not exist.</summary>
public static class CatalogState
{
    /// <summary>When the last complete sync ended (<see cref="ExerciseCatalogSync.SyncedAtKey"/>); null when there was none.</summary>
    public static async Task<DateTimeOffset?> LastSyncedAtAsync(AppDbContext db, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);

        var stored = await db.AppSecrets.AsNoTracking()
            .Where(s => s.Name == ExerciseCatalogSync.SyncedAtKey)
            .Select(s => s.Value)
            .SingleOrDefaultAsync(ct);
        return stored is not null && DateTimeOffset.TryParse(stored, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var last)
            ? last
            : null;
    }

    /// <summary>
    /// True when a sync ran to the end and the table has rows. Until then (first deploy, a sync that keeps failing, a fresh
    /// database) a missing id only means "not downloaded yet", never "gone".
    /// </summary>
    public static async Task<bool> IsSyncedAsync(AppDbContext db, CancellationToken ct) =>
        await LastSyncedAtAsync(db, ct) is not null && await db.CatalogExercises.AnyAsync(ct);
}
