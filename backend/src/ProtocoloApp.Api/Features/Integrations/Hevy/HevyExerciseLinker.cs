using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Integrations.Matching;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>
/// The user's exercise for a Hevy exercise (spec "Hevy", section 4), through <see cref="HevyExerciseLink"/> by template id:
/// <list type="number">
/// <item>an existing link whose exercise is alive (the title seen is refreshed);</item>
/// <item>an exact match (<see cref="HevyExerciseMatcher"/>) → <c>auto</c>;</item>
/// <item>an exercise with the same normalized name → <c>auto</c> (a removed one comes back, <c>pending</c>);</item>
/// <item>a new provisional exercise named after the title, with the template's muscle group → <c>pending</c>.</item>
/// </list>
/// <see cref="ResolveAsync"/> must run inside a <see cref="SyncWrites.BeginAsync"/> transaction and saves its own changes; it
/// never calls Hevy: the muscle groups of the templates <see cref="PeekAsync"/> says are new come in, already fetched.
/// </summary>
public static class HevyExerciseLinker
{
    /// <summary>Name of a provisional exercise whose Hevy title has nothing usable.</summary>
    private const string FallbackName = "Exercício do Hevy";

    /// <summary>
    /// Read-only: the exercise <see cref="ResolveAsync"/> would link <paramref name="ex"/> to now (a removed one with the same
    /// name included, it would come back), or null when it would create a provisional exercise (whose group is then needed).
    /// Writes nothing, so it runs before the write transaction (to know which templates to ask Hevy about) and before the
    /// workout's plan day is known (to choose it without creating anything).
    /// </summary>
    public static async Task<Guid?> PeekAsync(AppDbContext db, Guid userId, HevyExercise ex, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(ex);

        var linked = await db.HevyExerciseLinks.AsNoTracking()
            .Where(l => l.UserId == userId && l.TemplateId == ex.TemplateId)
            .Select(l => (Guid?)l.ExerciseId)
            .SingleOrDefaultAsync(ct);
        if (linked is { } id && await db.Exercises.AnyAsync(e => e.Id == id && e.UserId == userId && e.DeletedAt == null, ct))
            return id;

        return (await MatchAsync(db, userId, ex, TitleOf(ex), ct))?.Id;
    }

    /// <param name="templateGroups">
    /// The <c>primary_muscle_group</c> of templates, fetched before the transaction; a template missing from it (or null)
    /// gives a new exercise the "other" group.
    /// </param>
    public static async Task<Guid> ResolveAsync(
        AppDbContext db,
        Guid userId,
        HevyExercise ex,
        IReadOnlyDictionary<string, string?> templateGroups,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(ex);
        ArgumentNullException.ThrowIfNull(templateGroups);
        ArgumentNullException.ThrowIfNull(clock);

        var title = TitleOf(ex);
        var now = clock.GetUtcNow();
        var link = await db.HevyExerciseLinks.SingleOrDefaultAsync(l => l.UserId == userId && l.TemplateId == ex.TemplateId, ct);
        if (link is not null
            && await db.Exercises.AnyAsync(e => e.Id == link.ExerciseId && e.UserId == userId && e.DeletedAt == null, ct))
        {
            if (link.Title != title)
            {
                link.Title = title;
                link.UpdatedAt = now;
                await db.SaveChangesAsync(ct);
            }

            return link.ExerciseId;
        }

        Guid exerciseId;
        HevyLinkStatus status;
        var created = false;
        if (await MatchAsync(db, userId, ex, title, ct) is { } match)
        {
            (exerciseId, status) = (match.Id, match.Status);
            if (match.Removed)
            {
                // The name is unique per user, deleted or not: a removed exercise with this name comes back.
                var same = await db.Exercises.SingleAsync(e => e.Id == match.Id && e.UserId == userId, ct);
                same.DeletedAt = null;
                await SyncWrites.StampAsync(db, same, userId, clock, ct);
            }
        }
        else
        {
            var (name, normalized) = NameOf(ex, title);
            var exercise = new Exercise
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                Name = name,
                NormalizedName = normalized,
                PrimaryMuscleGroup = MuscleGroupOf(templateGroups.GetValueOrDefault(ex.TemplateId)),
            };
            await SyncWrites.StampAsync(db, exercise, userId, clock, ct);
            db.Exercises.Add(exercise);
            (exerciseId, status, created) = (exercise.Id, HevyLinkStatus.Pending, true);
        }

        if (link is null)
        {
            link = new HevyExerciseLink
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                TemplateId = ex.TemplateId,
                CreatedAt = now,
            };
            db.HevyExerciseLinks.Add(link);
        }

        link.Title = title;
        link.ExerciseId = exerciseId;
        link.Status = status;
        link.CreatedExercise = created;
        link.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        return exerciseId;
    }

    /// <summary>Hevy's muscle group (<c>primary_muscle_group</c>) as ours; anything unknown is <see cref="MuscleGroup.Other"/>.</summary>
    public static MuscleGroup MuscleGroupOf(string? hevyGroup) => hevyGroup?.Trim().ToLowerInvariant() switch
    {
        "chest" => MuscleGroup.Chest,
        "lats" or "upper_back" or "traps" => MuscleGroup.Back,
        "shoulders" => MuscleGroup.Shoulders,
        "biceps" => MuscleGroup.Biceps,
        "triceps" => MuscleGroup.Triceps,
        "quadriceps" => MuscleGroup.Quads,
        "hamstrings" => MuscleGroup.Hamstrings,
        "glutes" or "abductors" or "adductors" => MuscleGroup.Glutes,
        "calves" => MuscleGroup.Calves,
        "abdominals" => MuscleGroup.Abs,
        "forearms" => MuscleGroup.Forearms,
        "lower_back" => MuscleGroup.LowerBack,
        _ => MuscleGroup.Other,
    };

    /// <summary>An exercise of the user the title matches; <see cref="Removed"/> when it is a deleted one that has to come back.</summary>
    private sealed record Match(Guid Id, HevyLinkStatus Status, bool Removed);

    /// <summary>Steps 2 and 3 of the order, read-only: an exact match (<c>auto</c>), else the exercise with the same normalized name.</summary>
    private static async Task<Match?> MatchAsync(AppDbContext db, Guid userId, HevyExercise ex, string title, CancellationToken ct)
    {
        var live = (await db.Exercises.AsNoTracking()
                .Where(e => e.UserId == userId && e.DeletedAt == null)
                .OrderBy(e => e.CreatedAt).ThenBy(e => e.Id)
                .Select(e => new { e.Id, e.Name, e.Aliases, e.CatalogId })
                .ToListAsync(ct))
            .Select(e => new UserExerciseRef(e.Id, e.Name, e.Aliases, e.CatalogId))
            .ToList();
        if (HevyExerciseMatcher.Match(title, live) is { } matched)
            return new Match(matched, HevyLinkStatus.Auto, false);

        var (_, normalized) = NameOf(ex, title);
        var same = await db.Exercises.AsNoTracking()
            .Where(e => e.UserId == userId && e.NormalizedName == normalized)
            .Select(e => new { e.Id, Removed = e.DeletedAt != null })
            .SingleOrDefaultAsync(ct);
        if (same is null)
            return null;

        return same.Removed ? new Match(same.Id, HevyLinkStatus.Pending, true) : new Match(same.Id, HevyLinkStatus.Auto, false);
    }

    private static string TitleOf(HevyExercise ex) => Truncate((ex.Title ?? "").Trim(), HevyExerciseLink.MaxTitleLength);

    /// <summary>The name a provisional exercise gets (the title, or a fallback when it has nothing usable) and its normalized form.</summary>
    private static (string Name, string Normalized) NameOf(HevyExercise ex, string title)
    {
        var normalized = ExerciseNames.Normalize(title);
        if (ExerciseNames.IsUsable(normalized))
            return (title, normalized);

        var name = Truncate($"{FallbackName} {ex.TemplateId}", Exercise.MaxNameLength);
        return (name, ExerciseNames.Normalize(name));
    }

    private static string Truncate(string text, int max) => text.Length > max ? text[..max] : text;
}
