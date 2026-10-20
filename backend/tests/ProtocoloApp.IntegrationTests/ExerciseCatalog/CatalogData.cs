using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.ExerciseCatalog;
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

    public static async Task SeedAsync(ApiFactory factory, DateTimeOffset syncedAt, params string[] ids)
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
}
