using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Workouts;

namespace ProtocoloApp.Api.Features.Updates.Metrics;

/// <summary>Training metrics of an update cycle (<c>strength_changes</c>, <c>training_changes</c>). Pure: the caller loads and filters the rows of the cycle.</summary>
public static class TrainingMetrics
{
    private const int Picks = 2;

    /// <summary>Epley: weight × (1 + reps / 30). Zero reps gives 0. Same as <c>e1rm</c> in <c>frontend/src/domain/strength.ts</c>.</summary>
    public static decimal E1rm(decimal weightKg, int reps) => reps <= 0 ? 0m : weightKg * (1m + reps / 30m);

    /// <summary>
    /// Exact twin of <c>strengthByGroup</c> (<c>frontend/src/domain/strength.ts</c>) over sessions already limited to the cycle:
    /// per exercise, the best set (highest e1RM, no warm-ups, no drop/rest-pause sub-sets) of each session, in session order
    /// (date, then start); exercises with fewer than 2 sessions are left out. <c>Best</c> = top 2 by delta; <c>Worst</c> = the
    /// 2 lowest among the rest, only with delta &lt; 0. Groups with no exercise left are omitted; groups come in enum order.
    /// Deleted rows are ignored.
    /// </summary>
    public static IReadOnlyList<GroupStrength> StrengthChanges(
        IReadOnlyList<WorkoutSession> sessions,
        IReadOnlyList<SetLog> sets,
        IReadOnlyList<Exercise> exercises)
    {
        var ordered = sessions
            .Where(s => s.DeletedAt is null)
            .OrderBy(s => s.Date)
            .ThenBy(s => s.StartedAt)
            .ToList();

        var setsBySession = sets
            .Where(s => s.DeletedAt is null && s.Kind != SetKind.Warmup && s.ParentSetId is null)
            .ToLookup(s => s.SessionId);

        var perExercise = new Dictionary<Guid, List<decimal>>();
        foreach (var session in ordered)
        {
            foreach (var exerciseSets in setsBySession[session.Id].GroupBy(s => s.ExerciseId))
            {
                var best = exerciseSets.Max(s => E1rm(s.WeightKg, s.Reps));
                if (!perExercise.TryGetValue(exerciseSets.Key, out var values))
                    perExercise[exerciseSets.Key] = values = [];
                values.Add(best);
            }
        }

        var trends = new Dictionary<MuscleGroup, List<(StrengthTrend Trend, decimal Delta)>>();
        foreach (var exercise in exercises)
        {
            if (exercise.DeletedAt is not null || !perExercise.TryGetValue(exercise.Id, out var values) || values.Count < 2)
                continue;
            var first = values[0];
            var last = values[^1];
            var delta = last - first;
            var trend = new StrengthTrend(exercise.Id, exercise.Name, Round2(first), Round2(last), Round2(delta), values.Count);
            if (!trends.TryGetValue(exercise.PrimaryMuscleGroup, out var list))
                trends[exercise.PrimaryMuscleGroup] = list = [];
            list.Add((trend, delta));
        }

        var result = new List<GroupStrength>();
        foreach (var group in Enum.GetValues<MuscleGroup>())
        {
            if (!trends.TryGetValue(group, out var list))
                continue;
            // Stable sort on the unrounded delta, as in the front (ties keep the exercise order).
            var desc = list.OrderByDescending(t => t.Delta).ToList();
            var best = desc.Take(Picks).Select(t => t.Trend).ToList();
            var worst = desc.Skip(Picks).Where(t => t.Delta < 0).Reverse().Take(Picks).Select(t => t.Trend).ToList();
            result.Add(new GroupStrength(group, best, worst));
        }

        return result;
    }

    /// <summary>
    /// Workout plan activations and exercise changes of the cycle, by date; on the same date activations come first, then
    /// changes in the given order. Deleted changes are ignored.
    /// </summary>
    public static IReadOnlyList<TrainingChange> Changes(
        IReadOnlyList<(DateOnly Date, Guid PlanId)> workoutActivations,
        IReadOnlyList<(DateOnly Date, ExerciseChange Change, string? PlannedName, string? ReplacementName)> changes)
    {
        var activated = workoutActivations
            .Select(a => (a.Date, Order: 0, Item: new TrainingChange(a.Date, TrainingChangeKind.PlanActivated, null, null)));

        var changed = changes
            .Where(c => c.Change.DeletedAt is null)
            .Select(c => (c.Date, Order: 1, Item: c.Change.Action == ExerciseChangeAction.Swapped
                ? new TrainingChange(c.Date, TrainingChangeKind.Swapped, c.PlannedName, c.ReplacementName)
                : new TrainingChange(c.Date, TrainingChangeKind.Skipped, c.PlannedName, null)));

        return activated.Concat(changed)
            .OrderBy(x => x.Date)
            .ThenBy(x => x.Order)
            .Select(x => x.Item)
            .ToList();
    }

    internal static decimal Round2(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
}
