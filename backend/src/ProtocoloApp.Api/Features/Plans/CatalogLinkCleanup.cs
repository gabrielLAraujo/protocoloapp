using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.ExerciseCatalog;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>How many rows a <see cref="CatalogLinkCleanup"/> run changed.</summary>
public sealed record CatalogLinkCleanupResult(int Exercises, int Drafts);

/// <summary>
/// Once the catalog is synced, clears the links that point to no catalog item: the ones kept as they were while the catalog
/// was not downloaded yet (see <see cref="CatalogLinks"/>). Covers the exercises' <c>catalog_id</c> and the
/// <c>catalogId</c> of draft workouts (planned exercises and new-exercise suggestions). Each changed row is stamped, so
/// clients pull the change. Does nothing while the catalog is not synced. Idempotent.
/// </summary>
public static class CatalogLinkCleanup
{
    public static async Task<CatalogLinkCleanupResult> RunAsync(AppDbContext db, TimeProvider clock, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        if (!await CatalogState.IsSyncedAsync(db, ct))
            return new CatalogLinkCleanupResult(0, 0);

        var exerciseUsers = await db.Exercises.AsNoTracking()
            .Where(e => e.CatalogId != null && !db.CatalogExercises.Any(c => c.Id == e.CatalogId))
            .Select(e => e.UserId)
            .Distinct()
            .ToListAsync(ct);
        var draftUsers = await db.PlanVersions.AsNoTracking()
            .Where(p => p.Kind == PlanKind.Workout && p.Status == PlanStatus.Draft && p.DeletedAt == null)
            .Select(p => p.UserId)
            .Distinct()
            .ToListAsync(ct);

        var exercises = 0;
        var drafts = 0;
        foreach (var userId in exerciseUsers.Union(draftUsers))
        {
            var (userExercises, userDrafts) = await CleanUserAsync(db, userId, clock, ct);
            exercises += userExercises;
            drafts += userDrafts;
        }

        return new CatalogLinkCleanupResult(exercises, drafts);
    }

    private static async Task<(int Exercises, int Drafts)> CleanUserAsync(AppDbContext db, Guid userId, TimeProvider clock, CancellationToken ct)
    {
        await using var transaction = await SyncWrites.BeginAsync(db, userId, ct);

        var linked = await db.Exercises
            .Where(e => e.UserId == userId && e.CatalogId != null && !db.CatalogExercises.Any(c => c.Id == e.CatalogId))
            .ToListAsync(ct);
        foreach (var exercise in linked)
        {
            exercise.CatalogId = null;
            await SyncWrites.StampAsync(db, exercise, userId, clock, ct);
        }

        var plans = await db.PlanVersions
            .Where(p => p.UserId == userId && p.Kind == PlanKind.Workout && p.Status == PlanStatus.Draft && p.DeletedAt == null)
            .ToListAsync(ct);
        var nodes = plans
            .Select(p => (
                Plan: p,
                Document: JsonNode.Parse(p.Document.RootElement.GetRawText()),
                NewExercises: p.NewExercises is null ? null : JsonNode.Parse(p.NewExercises.RootElement.GetRawText())))
            .ToList();
        var ids = nodes.SelectMany(n => CatalogIdHolders(n.Document, n.NewExercises)).Select(h => h["catalogId"]!.GetValue<string>()).ToList();
        var kept = await CatalogLinks.KeptAsync(db, ids, ct);

        var changedDrafts = 0;
        foreach (var (plan, document, newExercises) in nodes)
        {
            var changed = false;
            foreach (var holder in CatalogIdHolders(document, newExercises).ToList())
            {
                if (kept.Contains(holder["catalogId"]!.GetValue<string>()))
                    continue;
                holder["catalogId"] = null;
                changed = true;
            }

            if (!changed)
                continue;

            if (document is not null)
            {
                plan.Document = JsonDocument.Parse(document.ToJsonString());
                db.Entry(plan).Property(p => p.Document).IsModified = true;
            }

            if (newExercises is not null)
            {
                plan.NewExercises = JsonDocument.Parse(newExercises.ToJsonString());
                db.Entry(plan).Property(p => p.NewExercises).IsModified = true;
            }

            await SyncWrites.StampAsync(db, plan, userId, clock, ct);
            changedDrafts++;
        }

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return (linked.Count, changedDrafts);
    }

    /// <summary>The objects that carry a string <c>catalogId</c>: <c>days[].exercises[]</c> of the document and the new-exercise suggestions.</summary>
    private static IEnumerable<JsonObject> CatalogIdHolders(JsonNode? document, JsonNode? newExercises)
    {
        var planned = document is JsonObject root && root["days"] is JsonArray days
            ? days.OfType<JsonObject>().Select(d => d["exercises"]).OfType<JsonArray>().SelectMany(a => a.OfType<JsonObject>())
            : Enumerable.Empty<JsonObject>();
        var suggested = newExercises is JsonArray list ? list.OfType<JsonObject>() : Enumerable.Empty<JsonObject>();
        return planned.Concat(suggested).Where(o => o["catalogId"] is JsonValue value && value.GetValueKind() == JsonValueKind.String);
    }
}
