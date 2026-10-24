using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>A Hevy exercise template linked to one of the user's exercises; <see cref="SetCount"/> = live sets imported from it.</summary>
public sealed record HevyExerciseLinkResponse(
    Guid Id,
    string TemplateId,
    string Title,
    Guid ExerciseId,
    string ExerciseName,
    HevyLinkStatus Status,
    int SetCount);

/// <summary>The exercise chosen for a link; null keeps the current one (the provisional exercise stays).</summary>
public sealed record ConfirmHevyExerciseRequest(Guid? ExerciseId);

/// <summary>
/// "Exercícios do Hevy para confirmar" (spec "Hevy", section 4), under <c>/api/integrations/hevy/exercises</c>. The device makes
/// the suggestion (its fuzzy <c>matchExercise</c> over <see cref="HevyExerciseLinkResponse.Title"/>); the server only applies the
/// choice, stamping every synced row it changes so devices pull it.
/// </summary>
public static class HevyExerciseEndpoints
{
    /// <summary>Most aliases an exercise keeps (same cap as the exercise endpoint).</summary>
    public const int MaxAliases = 20;

    public static void MapHevyExerciseEndpoints(this RouteGroupBuilder group)
    {
        ArgumentNullException.ThrowIfNull(group);

        group.MapGet("/exercises", ListAsync);
        group.MapPut("/exercises/{id:guid}", ConfirmAsync);
    }

    /// <summary>The links waiting for confirmation; with <paramref name="all"/>, every link (to fix a wrong match the same way).</summary>
    private static async Task<Ok<IReadOnlyList<HevyExerciseLinkResponse>>> ListAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken ct,
        bool all = false)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);

        var userId = principal.GetUserId();
        var links = await db.HevyExerciseLinks.AsNoTracking()
            .Where(l => l.UserId == userId && (all || l.Status == HevyLinkStatus.Pending))
            .OrderBy(l => l.Title).ThenBy(l => l.Id)
            .ToListAsync(ct);
        return TypedResults.Ok<IReadOnlyList<HevyExerciseLinkResponse>>(await ToResponsesAsync(db, userId, links, ct));
    }

    /// <summary>
    /// Confirms a link. With another exercise: the live sets imported from the template move to it (their planned exercise key
    /// recomputed from each session's plan day, as the import does), the Hevy title becomes one
    /// of its aliases (when usable, new and under the cap), and the provisional exercise is removed when the import created it,
    /// nothing uses it any more (sets, swaps) and no plan version mentions it. The link becomes <c>confirmed</c>. 404 for a link
    /// or an exercise of another user, or a removed exercise.
    /// </summary>
    private static async Task<Results<Ok<HevyExerciseLinkResponse>, NotFound>> ConfirmAsync(
        Guid id,
        ConfirmHevyExerciseRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        var userId = principal.GetUserId();
        await using var tx = await SyncWrites.BeginAsync(db, userId, ct);
        var link = await db.HevyExerciseLinks.SingleOrDefaultAsync(l => l.Id == id && l.UserId == userId, ct);
        if (link is null)
            return TypedResults.NotFound();

        var targetId = request?.ExerciseId ?? link.ExerciseId;
        if (targetId != link.ExerciseId)
        {
            var target = await db.Exercises.SingleOrDefaultAsync(e => e.Id == targetId && e.UserId == userId && e.DeletedAt == null, ct);
            if (target is null)
                return TypedResults.NotFound();

            var previousId = link.ExerciseId;
            var sets = await db.SetLogs
                .Where(s => s.UserId == userId && s.DeletedAt == null && s.HevyTemplateId == link.TemplateId && s.ExerciseId != targetId)
                .ToListAsync(ct);
            var plannedKeys = await PlannedKeysAsync(db, userId, sets.Select(x => x.SessionId).Distinct().ToList(), targetId, ct);
            foreach (var set in sets)
            {
                set.ExerciseId = targetId;
                set.PlannedExerciseKey = plannedKeys.GetValueOrDefault(set.SessionId);
                await SyncWrites.StampAsync(db, set, userId, clock, ct);
            }

            await db.SaveChangesAsync(ct);
            if (link.CreatedExercise)
                await RemoveIfUnusedAsync(db, userId, previousId, clock, ct);
            if (await LearnAliasAsync(db, userId, target, link.Title, ct))
                await SyncWrites.StampAsync(db, target, userId, clock, ct);

            link.ExerciseId = targetId;
            link.CreatedExercise = false;
        }

        link.Status = HevyLinkStatus.Confirmed;
        link.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        var response = await ToResponsesAsync(db, userId, [link], ct);
        return TypedResults.Ok(response[0]);
    }

    /// <summary>
    /// Per session, the key of <paramref name="exerciseId"/> in the session's plan day (as the importer sets it), null when the
    /// day does not plan it ("exercício extra") or the plan version cannot be read.
    /// </summary>
    private static async Task<Dictionary<Guid, string?>> PlannedKeysAsync(
        AppDbContext db, Guid userId, IReadOnlyList<Guid> sessionIds, Guid exerciseId, CancellationToken ct)
    {
        var sessions = await db.WorkoutSessions.AsNoTracking()
            .Where(x => x.UserId == userId && sessionIds.Contains(x.Id))
            .Select(x => new { x.Id, x.PlanVersionId, x.WorkoutDayKey })
            .ToListAsync(ct);
        var versionIds = sessions.Select(x => x.PlanVersionId).Distinct().ToList();
        var documents = new Dictionary<Guid, WorkoutDocument>();
        foreach (var version in await db.PlanVersions.AsNoTracking().Where(p => p.UserId == userId && versionIds.Contains(p.Id)).ToListAsync(ct))
        {
            if (PlanDocuments.TryRead<WorkoutDocument>(version.Document.RootElement, out var document, out _) && document is not null)
                documents[version.Id] = document;
        }

        var keys = new Dictionary<Guid, string?>();
        foreach (var session in sessions)
        {
            var day = documents.GetValueOrDefault(session.PlanVersionId)?.Days.FirstOrDefault(d => d?.Key == session.WorkoutDayKey);
            keys[session.Id] = (day?.Exercises ?? []).FirstOrDefault(e => e?.ExerciseId == exerciseId)?.Key;
        }

        return keys;
    }

    /// <summary>Soft-deletes the provisional exercise when no live set, no swap and no plan version (by id in its JSON) uses it.</summary>
    private static async Task RemoveIfUnusedAsync(AppDbContext db, Guid userId, Guid exerciseId, TimeProvider clock, CancellationToken ct)
    {
        var exercise = await db.Exercises.SingleOrDefaultAsync(e => e.Id == exerciseId && e.UserId == userId && e.DeletedAt == null, ct);
        if (exercise is null)
            return;
        if (await db.SetLogs.AnyAsync(s => s.UserId == userId && s.ExerciseId == exerciseId && s.DeletedAt == null, ct))
            return;
        if (await db.ExerciseChanges.AnyAsync(c => c.UserId == userId && c.ReplacementExerciseId == exerciseId && c.DeletedAt == null, ct))
            return;

        var pattern = $"%{exerciseId}%";
        var inPlan = await db.Database.SqlQuery<bool>($"""
            SELECT EXISTS (SELECT 1 FROM plan_versions p WHERE p.user_id = {userId} AND p.document::text LIKE {pattern}) AS "Value"
            """).SingleAsync(ct);
        if (inPlan)
            return;

        exercise.DeletedAt = clock.GetUtcNow();
        await SyncWrites.StampAsync(db, exercise, userId, clock, ct);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Adds the Hevy title as an alias of <paramref name="target"/>, so plan PDFs and later matches link by themselves. Skipped
    /// when it is not a usable name, the exercise already answers to it, another live exercise uses it, or the cap is reached.
    /// </summary>
    private static async Task<bool> LearnAliasAsync(AppDbContext db, Guid userId, Exercise target, string title, CancellationToken ct)
    {
        var alias = title.Trim();
        var normalized = ExerciseNames.Normalize(alias);
        if (!ExerciseNames.IsUsable(normalized) || target.Aliases.Length >= MaxAliases)
            return false;
        if (target.NormalizedName == normalized || target.Aliases.Any(a => ExerciseNames.Normalize(a) == normalized))
            return false;

        var others = await db.Exercises.AsNoTracking()
            .Where(e => e.UserId == userId && e.DeletedAt == null && e.Id != target.Id)
            .Select(e => new { e.NormalizedName, e.Aliases })
            .ToListAsync(ct);
        if (others.Any(e => e.NormalizedName == normalized || e.Aliases.Any(a => ExerciseNames.Normalize(a) == normalized)))
            return false;

        if (alias.Length > Exercise.MaxNameLength)
            alias = alias[..Exercise.MaxNameLength];
        target.Aliases = [.. target.Aliases, alias];
        return true;
    }

    private static async Task<List<HevyExerciseLinkResponse>> ToResponsesAsync(
        AppDbContext db, Guid userId, IReadOnlyList<HevyExerciseLink> links, CancellationToken ct)
    {
        var exerciseIds = links.Select(l => l.ExerciseId).Distinct().ToList();
        var names = await db.Exercises.AsNoTracking()
            .Where(e => e.UserId == userId && exerciseIds.Contains(e.Id))
            .ToDictionaryAsync(e => e.Id, e => e.Name, ct);
        var templateIds = links.Select(l => l.TemplateId).Distinct().ToList();
        var counts = await db.SetLogs.AsNoTracking()
            .Where(s => s.UserId == userId && s.DeletedAt == null && s.HevyTemplateId != null && templateIds.Contains(s.HevyTemplateId))
            .GroupBy(s => s.HevyTemplateId!)
            .Select(g => new { TemplateId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.TemplateId, g => g.Count, ct);
        return links
            .Select(l => new HevyExerciseLinkResponse(
                l.Id, l.TemplateId, l.Title, l.ExerciseId, names.GetValueOrDefault(l.ExerciseId, ""), l.Status, counts.GetValueOrDefault(l.TemplateId)))
            .ToList();
    }
}
