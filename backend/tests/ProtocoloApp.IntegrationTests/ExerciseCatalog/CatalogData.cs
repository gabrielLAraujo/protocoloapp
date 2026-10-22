using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.ExerciseCatalog;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.ExerciseCatalog;

/// <summary>Direct access to the (global) catalog tables. The tests of the <c>api</c> collection run one at a time, so each one clears and seeds what it needs.</summary>
internal static class CatalogData
{
    public static async Task ResetAsync(ApiFactory factory)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.CatalogExercises.ExecuteDeleteAsync();
        await db.AppSecrets.Where(s => s.Name == ExerciseCatalogSync.SyncedAtKey).ExecuteDeleteAsync();
    }

    /// <summary>Catalog rows plus the mark of a complete sync: unknown ids are then really unknown.</summary>
    public static async Task SeedAsync(ApiFactory factory, DateTimeOffset syncedAt, params string[] ids)
    {
        await SeedRowsAsync(factory, syncedAt, ids);
        await MarkSyncedAsync(factory, syncedAt);
    }

    /// <summary>Catalog rows without the mark: a sync that stopped halfway (first deploy, ExerciseDB failing).</summary>
    public static async Task SeedRowsAsync(ApiFactory factory, DateTimeOffset syncedAt, params string[] ids)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        foreach (var id in ids)
        {
            db.CatalogExercises.Add(new CatalogExercise
            {
                Id = id,
                Name = $"exercise {id}",
                BodyParts = ["upper arms"],
                TargetMuscles = ["biceps"],
                SecondaryMuscles = ["forearms"],
                Equipments = ["cable"],
                GifUrl = $"https://static.exercisedb.dev/media/{id}.gif",
                SyncedAt = syncedAt,
            });
        }

        await db.SaveChangesAsync();
    }

    public static async Task MarkSyncedAsync(ApiFactory factory, DateTimeOffset syncedAt)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var value = syncedAt.ToString("O", CultureInfo.InvariantCulture);
        var secret = await db.AppSecrets.SingleOrDefaultAsync(s => s.Name == ExerciseCatalogSync.SyncedAtKey);
        if (secret is null)
            db.AppSecrets.Add(new AppSecret { Name = ExerciseCatalogSync.SyncedAtKey, Value = value, CreatedAt = syncedAt });
        else
            secret.Value = value;
        await db.SaveChangesAsync();
    }
}
