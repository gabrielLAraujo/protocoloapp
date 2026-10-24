using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>
/// Which plan version and workout day a Hevy workout belongs to (spec "Hevy", section 3). The version is the workout plan
/// active on the local date (greatest activation date up to it; same date: the latest activation). The day, in order:
/// <list type="number">
/// <item>the day whose normalized name equals the workout's title;</item>
/// <item>the day with the most exercises in common with the workout (a tie goes to the rotation's day when it is one of
/// the tied days, otherwise to the first of them);</item>
/// <item>the rotation's day on that date (overrides included, as <see cref="DayPlanner.ResolveDay"/>);</item>
/// <item>the first day of the plan.</item>
/// </list>
/// </summary>
public static class HevyDayResolver
{
    public static (Guid PlanVersionId, string DayKey)? Resolve(
        DateOnly date,
        HevyWorkout w,
        IReadOnlyList<Guid?> mappedExerciseIds,
        IReadOnlyList<(PlanVersion Version, WorkoutDocument Doc, DateOnly ActivatedOn)> plans,
        IReadOnlyList<RotationOverrideRow> overrides)
    {
        ArgumentNullException.ThrowIfNull(w);
        ArgumentNullException.ThrowIfNull(mappedExerciseIds);
        ArgumentNullException.ThrowIfNull(plans);
        ArgumentNullException.ThrowIfNull(overrides);

        (PlanVersion Version, WorkoutDocument Doc, DateOnly ActivatedOn)? active = null;
        foreach (var plan in plans)
        {
            if (plan.ActivatedOn > date)
                continue;
            if (active is not { } a || plan.ActivatedOn > a.ActivatedOn
                || (plan.ActivatedOn == a.ActivatedOn && (plan.Version.ActivatedAt ?? default) >= (a.Version.ActivatedAt ?? default)))
                active = plan;
        }

        if (active is not { } chosen)
            return null;

        var days = (chosen.Doc.Days ?? []).Where(d => d is not null && !string.IsNullOrEmpty(d.Key)).ToList();
        if (days.Count == 0)
            return null;

        var versionId = chosen.Version.Id;

        // 1. The title names the day ("Treino A").
        var title = ExerciseNames.Normalize(w.Title ?? "");
        if (title.Length > 0)
        {
            var named = days.FirstOrDefault(d => ExerciseNames.Normalize(d.Name ?? "") == title);
            if (named is not null)
                return (versionId, named.Key);
        }

        var rotationDay = RotationDay(date, plans, overrides, days);

        // 2. The most exercises in common.
        var mapped = mappedExerciseIds.Where(id => id is not null).Select(id => id!.Value).ToHashSet();
        if (mapped.Count > 0)
        {
            var scored = days
                .Select(d => (Day: d, Common: (d.Exercises ?? []).Where(e => e?.ExerciseId is not null).Select(e => e.ExerciseId!.Value).Distinct().Count(mapped.Contains)))
                .ToList();
            var best = scored.Max(s => s.Common);
            if (best > 0)
            {
                var tied = scored.Where(s => s.Common == best).Select(s => s.Day).ToList();
                if (tied.Count == 1)
                    return (versionId, tied[0].Key);
                var fromRotation = tied.FirstOrDefault(d => d.Key == rotationDay);
                return (versionId, (fromRotation ?? tied[0]).Key);
            }
        }

        // 3. The rotation; 4. the first day.
        return (versionId, rotationDay ?? days[0].Key);
    }

    /// <summary>The local date of an instant in <paramref name="zone"/> (America/Sao_Paulo in production).</summary>
    public static DateOnly LocalDate(DateTimeOffset instant, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);
    }

    private static string? RotationDay(
        DateOnly date,
        IReadOnlyList<(PlanVersion Version, WorkoutDocument Doc, DateOnly ActivatedOn)> plans,
        IReadOnlyList<RotationOverrideRow> overrides,
        IReadOnlyList<WorkoutDayDto> days)
    {
        var workouts = plans
            .Select(p => new WorkoutPlanAt(p.Version.ActivatedAt ?? default, p.ActivatedOn, p.Doc.Rotation))
            .ToList();
        var (kind, key) = DayPlanner.ResolveDay(date, workouts, overrides);
        return kind == DayKind.Training && days.Any(d => d.Key == key) ? key : null;
    }
}
