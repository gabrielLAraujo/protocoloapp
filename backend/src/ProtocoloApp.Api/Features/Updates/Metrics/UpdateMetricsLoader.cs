using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;
using ProtocoloApp.Api.Features.Workouts;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Updates.Metrics;

/// <summary>
/// Loads the rows of an update cycle and runs the pure metrics over them (<see cref="AdherenceMetrics"/>,
/// <see cref="TrainingMetrics"/>, <see cref="CheckinMetrics"/>). Read-only (<c>AsNoTracking</c>); nothing is logged.
/// </summary>
public static class UpdateMetricsLoader
{
    private const string WaterGuideline = "water_min_l";

    /// <summary>The metrics of the user's cycle, or null when it does not exist, is deleted or belongs to someone else.</summary>
    public static async Task<UpdateMetricsResponse?> LoadAsync(
        AppDbContext db, Guid userId, Guid cycleId, TimeProvider clock, TimeZoneInfo zone, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(zone);

        var cycle = await db.UpdateCycles.AsNoTracking()
            .SingleOrDefaultAsync(c => c.Id == cycleId && c.UserId == userId && c.DeletedAt == null, ct);
        if (cycle is null)
            return null;

        var now = clock.GetUtcNow();
        var today = LocalDate(now, zone);
        var from = cycle.PeriodStart;
        var to = cycle.PeriodEnd < today ? cycle.PeriodEnd : today;

        // Plans: the cycle's protocol, and every workout version that was activated (DayPlanner picks the one of each day).
        var versions = await db.PlanVersions.AsNoTracking()
            .Where(p => p.UserId == userId && ((p.DeletedAt == null && p.ActivatedAt != null && p.Kind == PlanKind.Workout) || p.Id == cycle.ProtocolVersionId))
            .Select(p => new { p.Id, p.Kind, p.ActivatedAt, p.Document })
            .ToListAsync(ct);

        ProtocolDocument? protocol = null;
        DateOnly? protocolActivatedOn = null;
        var protocolVersion = versions.SingleOrDefault(v => v.Id == cycle.ProtocolVersionId && v.Kind == PlanKind.Protocol);
        if (protocolVersion is not null && PlanDocuments.TryRead<ProtocolDocument>(protocolVersion.Document.RootElement, out var protocolDocument, out _))
        {
            protocol = protocolDocument;
            protocolActivatedOn = protocolVersion.ActivatedAt is { } at ? LocalDate(at, zone) : from;
        }

        var workoutPlans = new List<WorkoutPlanAt>();
        var workoutDocuments = new Dictionary<Guid, WorkoutDocument>();
        var activations = new List<(DateOnly Date, Guid PlanId)>();
        foreach (var v in versions.Where(v => v.Kind == PlanKind.Workout && v.ActivatedAt != null).OrderBy(v => v.ActivatedAt))
        {
            var activatedOn = LocalDate(v.ActivatedAt!.Value, zone);
            if (activatedOn >= from && activatedOn <= to)
                activations.Add((activatedOn, v.Id));
            // Same as the client: an unreadable version is skipped, so the previous one keeps applying.
            if (!PlanDocuments.TryRead<WorkoutDocument>(v.Document.RootElement, out var workout, out _) || workout is null)
                continue;
            workoutDocuments[v.Id] = workout;
            workoutPlans.Add(new WorkoutPlanAt(v.ActivatedAt.Value, activatedOn, workout.Rotation));
        }

        var overrides = (await db.RotationOverrides.AsNoTracking()
                .Where(o => o.UserId == userId && o.DeletedAt == null)
                .Select(o => new { o.Date, o.WorkoutDayKey })
                .ToListAsync(ct))
            .Select(o => new RotationOverrideRow(o.Date, o.WorkoutDayKey))
            .ToList();

        var slots = (await db.ScheduleSlots.AsNoTracking()
                .Where(s => s.UserId == userId && s.DeletedAt == null)
                .Select(s => new { s.Slot, s.DayType, s.Time, s.ReminderEnabled })
                .ToListAsync(ct))
            .Select(s => new ScheduleSlotRow(s.Slot, s.DayType, s.Time, s.ReminderEnabled))
            .ToList();

        var days = new List<(DateOnly Date, DayPlan Plan)>();
        for (var date = from; date <= to; date = date.AddDays(1))
            days.Add((date, DayPlanner.Build(date, protocol, workoutPlans, overrides, slots, protocolActivatedOn)));

        var logs = await db.AdherenceLogs.AsNoTracking()
            .Where(l => l.UserId == userId && l.DeletedAt == null && l.Date >= from && l.Date <= to)
            .ToListAsync(ct);
        var deviations = await db.DietDeviations.AsNoTracking()
            .Where(d => d.UserId == userId && d.DeletedAt == null && d.Date >= from && d.Date <= to)
            .OrderBy(d => d.Date).ThenBy(d => d.CreatedAt)
            .ToListAsync(ct);
        var checkins = await db.DailyCheckins.AsNoTracking()
            .Where(c => c.UserId == userId && c.DeletedAt == null && c.Date >= from && c.Date <= to)
            .OrderBy(c => c.Date)
            .ToListAsync(ct);

        var sessions = await db.WorkoutSessions.AsNoTracking()
            .Where(s => s.UserId == userId && s.DeletedAt == null && s.Date >= from && s.Date <= to)
            .OrderBy(s => s.Date).ThenBy(s => s.StartedAt)
            .ToListAsync(ct);
        var sessionIds = sessions.Select(s => s.Id).ToList();
        var sets = await db.SetLogs.AsNoTracking()
            .Where(s => s.UserId == userId && s.DeletedAt == null && sessionIds.Contains(s.SessionId))
            .ToListAsync(ct);
        var changes = await db.ExerciseChanges.AsNoTracking()
            .Where(c => c.UserId == userId && c.DeletedAt == null && sessionIds.Contains(c.SessionId))
            .OrderBy(c => c.CreatedAt)
            .ToListAsync(ct);

        // Same rule as workoutRepo.workedOutDates: a finished session with at least one live working (non-warm-up) set.
        var sessionsWithWork = sets.Where(s => s.Kind != SetKind.Warmup).Select(s => s.SessionId).ToHashSet();
        var workedOut = sessions
            .Where(s => s.EndedAt != null && sessionsWithWork.Contains(s.Id))
            .Select(s => s.Date)
            .ToHashSet();

        var exerciseIds = sets.Select(s => s.ExerciseId)
            .Concat(changes.Where(c => c.ReplacementExerciseId != null).Select(c => c.ReplacementExerciseId!.Value))
            .Distinct()
            .ToList();
        var exercises = await db.Exercises.AsNoTracking()
            .Where(e => e.UserId == userId && exerciseIds.Contains(e.Id))
            .ToListAsync(ct);
        var exerciseNames = exercises.ToDictionary(e => e.Id, e => e.Name);

        var meals = protocol?.Meals ?? [];
        var mealLabels = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var i = 0; i < meals.Count; i++)
            mealLabels.TryAdd(meals[i].Key, string.IsNullOrWhiteSpace(meals[i].Label) ? $"REF {i + 1}" : meals[i].Label);

        var adherence = AdherenceMetrics.Compute(new AdherenceInput(
            days, today, logs, deviations, checkins, workedOut, protocol?.Cardio, mealLabels));

        var sessionById = sessions.ToDictionary(s => s.Id);
        var changeRows = changes
            .Select(c => (Change: c, Session: sessionById[c.SessionId]))
            .OrderBy(x => x.Session.Date).ThenBy(x => x.Session.StartedAt)
            .Select(x => (
                x.Session.Date,
                x.Change,
                PlannedNameOf(workoutDocuments.GetValueOrDefault(x.Session.PlanVersionId), x.Session.WorkoutDayKey, x.Change.PlannedExerciseKey),
                x.Change.ReplacementExerciseId is { } replacement ? exerciseNames.GetValueOrDefault(replacement) : null))
            .ToList();

        var waterTarget = protocol?.Guidelines?.FirstOrDefault(g => g.Kind == WaterGuideline && g.Value != null)?.Value;
        var checkin = CheckinMetrics.Compute(checkins, waterTarget);

        return new UpdateMetricsResponse(
            cycle.Id,
            from,
            to,
            now,
            adherence.DietErrorPct,
            adherence.DietWrongMeals,
            adherence.DietDeviations,
            adherence.MissedWorkouts,
            adherence.MissedCardio,
            adherence.ItemsMissed,
            TrainingMetrics.StrengthChanges(sessions, sets, exercises),
            WithPlanNames(TrainingMetrics.Changes(activations, changeRows), activations, workoutDocuments),
            checkin.Weight,
            checkin.WaterAvg,
            checkin.SleepAvg,
            checkin.EnergyAvg,
            checkin.AnxietyAvg,
            checkin.CheckinNotes);
    }

    /// <summary>
    /// A workout plan has no name of its own: a <c>plan_activated</c> change carries its day names ("Treino A / Treino B") in
    /// <c>ExerciseName</c>, null when the document is unreadable. <see cref="TrainingMetrics.Changes"/> keeps the activations
    /// in input order (sorted by activation), so the k-th <c>plan_activated</c> is <paramref name="activations"/>[k].
    /// </summary>
    private static List<TrainingChange> WithPlanNames(
        IReadOnlyList<TrainingChange> changes, IReadOnlyList<(DateOnly Date, Guid PlanId)> activations, IReadOnlyDictionary<Guid, WorkoutDocument> documents)
    {
        var k = 0;
        var result = new List<TrainingChange>(changes.Count);
        foreach (var change in changes)
        {
            if (change.Kind != TrainingChangeKind.PlanActivated || k >= activations.Count)
            {
                result.Add(change);
                continue;
            }

            var names = documents.TryGetValue(activations[k++].PlanId, out var document)
                ? document.Days.Select(d => d.Name).Where(n => !string.IsNullOrWhiteSpace(n)).ToList()
                : [];
            result.Add(change with { ExerciseName = names.Count == 0 ? null : string.Join(" / ", names) });
        }

        return result;
    }

    /// <summary>Name of the planned exercise in the session's workout plan: its day first, then any day.</summary>
    private static string? PlannedNameOf(WorkoutDocument? document, string dayKey, string plannedKey)
    {
        if (document is null)
            return null;
        var day = document.Days.FirstOrDefault(d => d.Key == dayKey);
        var exercise = day?.Exercises.FirstOrDefault(e => e.Key == plannedKey)
            ?? document.Days.SelectMany(d => d.Exercises).FirstOrDefault(e => e.Key == plannedKey);
        return exercise?.Name;
    }

    private static DateOnly LocalDate(DateTimeOffset instant, TimeZoneInfo zone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);
}
