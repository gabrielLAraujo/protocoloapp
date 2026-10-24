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
/// Must run inside a <see cref="SyncWrites.BeginAsync"/> transaction; it saves its own changes.
/// </summary>
public static class HevyExerciseLinker
{
    /// <summary>Name of a provisional exercise whose Hevy title has nothing usable.</summary>
    private const string FallbackName = "Exercício do Hevy";

    /// <param name="templateGroup">The template's <c>primary_muscle_group</c> (null when unknown); called only for a new exercise.</param>
    public static async Task<Guid> ResolveAsync(
        AppDbContext db,
        Guid userId,
        HevyExercise ex,
        Func<string, Task<string?>> templateGroup,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(ex);
        ArgumentNullException.ThrowIfNull(templateGroup);
        ArgumentNullException.ThrowIfNull(clock);

        var title = Truncate((ex.Title ?? "").Trim(), HevyExerciseLink.MaxTitleLength);
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

        var (exerciseId, status, created) = await MatchOrCreateAsync(db, userId, ex, title, templateGroup, clock, ct);
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

    private static async Task<(Guid Id, HevyLinkStatus Status, bool Created)> MatchOrCreateAsync(
        AppDbContext db,
        Guid userId,
        HevyExercise ex,
        string title,
        Func<string, Task<string?>> templateGroup,
        TimeProvider clock,
        CancellationToken ct)
    {
        var live = (await db.Exercises.AsNoTracking()
                .Where(e => e.UserId == userId && e.DeletedAt == null)
                .OrderBy(e => e.CreatedAt).ThenBy(e => e.Id)
                .Select(e => new { e.Id, e.Name, e.Aliases, e.CatalogId })
                .ToListAsync(ct))
            .Select(e => new UserExerciseRef(e.Id, e.Name, e.Aliases, e.CatalogId))
            .ToList();
        if (HevyExerciseMatcher.Match(title, live) is { } matched)
            return (matched, HevyLinkStatus.Auto, false);

        var name = title;
        var normalized = ExerciseNames.Normalize(name);
        if (!ExerciseNames.IsUsable(normalized))
        {
            name = Truncate($"{FallbackName} {ex.TemplateId}", Exercise.MaxNameLength);
            normalized = ExerciseNames.Normalize(name);
        }

        var same = await db.Exercises.SingleOrDefaultAsync(e => e.UserId == userId && e.NormalizedName == normalized, ct);
        if (same is not null)
        {
            if (same.DeletedAt is null)
                return (same.Id, HevyLinkStatus.Auto, false);

            // The name is unique per user, deleted or not: a removed exercise with this name comes back.
            same.DeletedAt = null;
            await SyncWrites.StampAsync(db, same, userId, clock, ct);
            return (same.Id, HevyLinkStatus.Pending, false);
        }

        var exercise = new Exercise
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = name,
            NormalizedName = normalized,
            PrimaryMuscleGroup = MuscleGroupOf(await templateGroup(ex.TemplateId)),
        };
        await SyncWrites.StampAsync(db, exercise, userId, clock, ct);
        db.Exercises.Add(exercise);
        return (exercise.Id, HevyLinkStatus.Pending, true);
    }

    private static string Truncate(string text, int max) => text.Length > max ? text[..max] : text;
}
