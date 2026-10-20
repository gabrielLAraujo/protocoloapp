using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.ExerciseCatalog;

/// <summary>How a catalog download ended.</summary>
public sealed record CatalogSyncResult(int Pages, int Upserted, bool Complete);

/// <summary>
/// Downloads the ExerciseDB catalog into <c>catalog_exercises</c> at start when it is empty or its last complete sync is older
/// than <see cref="ExerciseCatalogOptions.RefreshAfterDays"/>. Pages of 25 with the <c>after</c> cursor, a pause between pages;
/// stops when there is no next page, when a page brings no new id (the API sometimes repeats pages) or after
/// <see cref="MaxPages"/>. A failed run keeps what it got and is tried again at the next start. It never takes the host down
/// and logs only counts and status codes.
/// </summary>
public sealed class ExerciseCatalogSync(
    IServiceScopeFactory scopes,
    IExerciseDbClient client,
    TimeProvider clock,
    IOptions<ExerciseCatalogOptions> options,
    ILogger<ExerciseCatalogSync> logger) : BackgroundService
{
    public const int MaxPages = 100;

    /// <summary>Name in <c>app_secrets</c> of the moment the last complete sync ended (ISO 8601; not a secret).</summary>
    public const string SyncedAtKey = "exercise_catalog_synced_at";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
            return;

        try
        {
            // Let the host finish starting (and the migrations bundle have run) before the first query.
            await Task.Yield();
            if (!await IsDueAsync(stoppingToken))
                return;

            var result = await SyncAsync(stoppingToken);
            logger.LogInformation(
                "Exercise catalog sync finished: {Pages} pages, {Upserted} exercises, complete {Complete}.",
                result.Pages, result.Upserted, result.Complete);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            // Only the type: messages of database errors may carry values.
            logger.LogError("Exercise catalog sync failed: {Error}.", ex.GetType().Name);
        }
    }

    /// <summary>True when the catalog is empty, was never completely synced, or the last complete sync is old.</summary>
    public async Task<bool> IsDueAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        if (!await db.CatalogExercises.AnyAsync(ct))
            return true;

        var stored = await db.AppSecrets.AsNoTracking().Where(s => s.Name == SyncedAtKey).Select(s => s.Value).SingleOrDefaultAsync(ct);
        if (stored is null || !DateTimeOffset.TryParse(stored, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out var last))
            return true;

        return clock.GetUtcNow() - last > TimeSpan.FromDays(options.Value.RefreshAfterDays);
    }

    /// <summary>Downloads and upserts the whole catalog. Idempotent: running it twice leaves the same rows.</summary>
    public async Task<CatalogSyncResult> SyncAsync(CancellationToken ct)
    {
        var delay = TimeSpan.FromMilliseconds(Math.Max(0, options.Value.PageDelayMilliseconds));
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var pages = 0;
        var upserted = 0;
        var complete = false;
        string? cursor = null;

        while (pages < MaxPages)
        {
            if (pages > 0 && delay > TimeSpan.Zero)
                await Task.Delay(delay, clock, ct);

            var page = await client.GetPageAsync(cursor, ct);
            if (page is null)
                break;

            pages++;
            var fresh = page.Items.Where(i => seen.Add(i.Id)).ToList();
            if (fresh.Count == 0)
            {
                complete = true;
                break;
            }

            upserted += await UpsertAsync(fresh, ct);

            if (!page.HasNextPage || string.IsNullOrEmpty(page.NextCursor) || page.NextCursor == cursor)
            {
                complete = true;
                break;
            }

            cursor = page.NextCursor;
        }

        // Hitting the page cap also counts as done: the catalog is far smaller than 100 pages, the cap only stops a loop.
        complete |= pages >= MaxPages;
        if (complete)
            await MarkSyncedAsync(ct);
        return new CatalogSyncResult(pages, upserted, complete);
    }

    private async Task<int> UpsertAsync(List<ExerciseDbItem> items, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var ids = items.Select(i => i.Id).ToList();
        var existing = await db.CatalogExercises.Where(e => ids.Contains(e.Id)).ToDictionaryAsync(e => e.Id, StringComparer.Ordinal, ct);
        var now = clock.GetUtcNow();

        foreach (var item in items)
        {
            if (!existing.TryGetValue(item.Id, out var row))
            {
                row = new CatalogExercise { Id = item.Id };
                db.CatalogExercises.Add(row);
            }

            row.Name = item.Name;
            row.BodyParts = item.BodyParts;
            row.TargetMuscles = item.TargetMuscles;
            row.SecondaryMuscles = item.SecondaryMuscles;
            row.Equipments = item.Equipments;
            row.GifUrl = ExerciseDbClient.SafeGifUrl(item.GifUrl);
            row.SyncedAt = now;
        }

        await db.SaveChangesAsync(ct);
        return items.Count;
    }

    private async Task MarkSyncedAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = clock.GetUtcNow();
        var value = now.ToString("O", System.Globalization.CultureInfo.InvariantCulture);
        var secret = await db.AppSecrets.SingleOrDefaultAsync(s => s.Name == SyncedAtKey, ct);
        if (secret is null)
            db.AppSecrets.Add(new AppSecret { Name = SyncedAtKey, Value = value, CreatedAt = now });
        else
            secret.Value = value;
        await db.SaveChangesAsync(ct);
    }
}
