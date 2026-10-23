using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;

namespace ProtocoloApp.Api.Features.Updates.Metrics;

/// <summary>
/// The adherence fill metrics of an update cycle (<c>diet_error_pct</c>, <c>diet_wrong_meals</c>, <c>diet_deviations</c>,
/// <c>missed_workouts</c>, <c>missed_cardio</c>, <c>items_missed</c>, <c>items_used</c>). Pure: reads only <see cref="AdherenceInput"/>.
/// A past day counts every target; today counts only the marked ones; later days are ignored.
/// </summary>
public static class AdherenceMetrics
{
    public const string Unmarked = "unmarked";
    public const string Deviation = "deviation";

    /// <summary>A partial or missed log without a reason is grouped as <c>other</c>.</summary>
    public const string NoReason = "other";

    public static AdherenceResult Compute(AdherenceInput input)
    {
        ArgumentNullException.ThrowIfNull(input);

        var days = input.Days.Where(d => d.Date <= input.Today).OrderBy(d => d.Date).ToList();
        var dates = days.Select(d => d.Date).ToHashSet();
        var logs = new Dictionary<(DateOnly, AdherenceTargetType, string), AdherenceLog>();
        foreach (var log in input.Logs.Where(l => l.DeletedAt is null))
            logs[(log.Date, log.TargetType, log.TargetKey)] = log;
        var deviations = input.Deviations
            .Where(d => d.DeletedAt is null && dates.Contains(d.Date))
            .Select((d, i) => (Row: d, Index: i))
            .OrderBy(d => d.Row.Date).ThenBy(d => d.Row.Time is null).ThenBy(d => d.Row.Time).ThenBy(d => d.Index)
            .Select(d => d.Row)
            .ToList();
        var cardioCheckins = input.Checkins
            .Where(c => c.DeletedAt is null && c.CardioDone == true)
            .Select(c => c.Date)
            .ToHashSet();

        AdherenceLog? LogOf(DateOnly date, DayTarget target) =>
            logs.GetValueOrDefault((date, target.Type, target.Key));

        IReadOnlyList<(int Week, DateOnly From, DateOnly To)> weeks = days.Count == 0 ? [] : CycleWeeks.Split(days[0].Date, days[^1].Date);
        int WeekOf(DateOnly date) => CycleWeeks.WeekOf(days[0].Date, date);

        // Diet: per week, planned / done / wrong-meal reasons.
        var dietPlanned = new int[weeks.Count];
        var dietDone = new int[weeks.Count];
        var wrongReasons = weeks.Select(_ => new Dictionary<string, int>(StringComparer.Ordinal)).ToArray();
        var items = new Dictionary<string, (string Name, int Missed, Dictionary<string, int> Reasons)>(StringComparer.Ordinal);
        var itemOrder = new List<string>();
        var uses = new Dictionary<string, (string Name, int Done, int Partial, int Planned)>(StringComparer.Ordinal);
        var useOrder = new List<string>();
        var workoutPlannedPerWeek = new int[weeks.Count];
        var missedWorkoutDates = new List<DateOnly>();
        var cardioDaysPerWeek = new int[weeks.Count];
        var cardioDonePerWeek = new int[weeks.Count];

        foreach (var (date, plan) in days)
        {
            var today = date == input.Today;
            var w = WeekOf(date) - 1;
            foreach (var target in plan.Targets)
            {
                var log = LogOf(date, target);
                if (target.Type == AdherenceTargetType.Cardio)
                {
                    // Done by its own mark or by the check-in's cardio answer.
                    var cardioDone = log?.Status == AdherenceStatus.Done || cardioCheckins.Contains(date);
                    if (today && !cardioDone)
                        continue;
                    cardioDaysPerWeek[w]++;
                    if (cardioDone)
                        cardioDonePerWeek[w]++;
                    continue;
                }

                if (today && log is null)
                    continue;

                switch (target.Type)
                {
                    case AdherenceTargetType.Meal:
                        dietPlanned[w]++;
                        if (log?.Status == AdherenceStatus.Done)
                            dietDone[w]++;
                        else
                            Increment(wrongReasons[w], ReasonOf(log));
                        break;

                    case AdherenceTargetType.ProtocolItem:
                        if (!uses.TryGetValue(target.Key, out var use))
                        {
                            use = (target.Label, 0, 0, 0);
                            useOrder.Add(target.Key);
                        }

                        uses[target.Key] = (
                            target.Label,
                            use.Done + (log?.Status == AdherenceStatus.Done ? 1 : 0),
                            use.Partial + (log?.Status == AdherenceStatus.Partial ? 1 : 0),
                            use.Planned + 1);
                        if (log is not null && log.Status != AdherenceStatus.Missed)
                            break;
                        if (!items.TryGetValue(target.Key, out var item))
                        {
                            item = (target.Label, 0, new Dictionary<string, int>(StringComparer.Ordinal));
                            itemOrder.Add(target.Key);
                        }

                        Increment(item.Reasons, ReasonOf(log));
                        items[target.Key] = (target.Label, item.Missed + 1, item.Reasons);
                        break;
                }
            }

            if (plan.DayType == DayKind.Training)
            {
                var worked = input.WorkedOutDates.Contains(date);
                if (today && !worked)
                    continue;
                workoutPlannedPerWeek[w]++;
                if (!worked)
                    missedWorkoutDates.Add(date);
            }
        }

        foreach (var deviation in deviations)
        {
            var w = WeekOf(deviation.Date) - 1;
            dietPlanned[w]++;
            Increment(wrongReasons[w], Deviation);
        }

        var weekRates = new List<WeekRate>();
        var wrongMeals = new List<WeekWrongMeals>();
        for (var i = 0; i < weeks.Count; i++)
        {
            if (dietPlanned[i] == 0)
                continue;
            var (week, from, to) = weeks[i];
            weekRates.Add(new WeekRate(week, from, to, dietPlanned[i], dietDone[i], ErrorPct(dietPlanned[i], dietDone[i])));
            wrongMeals.Add(new WeekWrongMeals(week, from, to, wrongReasons[i].Values.Sum(), Sorted(wrongReasons[i])));
        }

        var plannedTotal = dietPlanned.Sum();
        var doneTotal = dietDone.Sum();

        var dietDeviations = deviations
            .Select(d => new DietDeviationEntry(
                d.Date,
                d.MealKey,
                d.MealKey is { } key && input.MealLabels.TryGetValue(key, out var label) ? label : null,
                d.Time,
                d.Description,
                d.Quantity))
            .ToList();

        string? CategoryOf(string key) => input.ItemCategories?.GetValueOrDefault(key);

        var itemsMissed = itemOrder
            .Select(key => (Key: key, Item: items[key]))
            .OrderByDescending(x => x.Item.Missed)
            .ThenBy(x => x.Key, StringComparer.Ordinal)
            .Select(x => new ItemMisses(x.Key, x.Item.Name, CategoryOf(x.Key), x.Item.Missed, Sorted(x.Item.Reasons)))
            .ToList();

        var itemsUsed = useOrder
            .Select(key => (Key: key, Use: uses[key]))
            .Where(x => x.Use.Done + x.Use.Partial > 0)
            .Select(x => new ItemUse(x.Key, x.Use.Name, CategoryOf(x.Key), x.Use.Done, x.Use.Partial, x.Use.Planned))
            .ToList();

        var workoutWeeks = new List<WeekWorkoutMisses>();
        for (var i = 0; i < weeks.Count; i++)
        {
            if (workoutPlannedPerWeek[i] == 0)
                continue;
            var (week, from, to) = weeks[i];
            var missedInWeek = missedWorkoutDates.Where(d => d >= from && d <= to).ToList();
            workoutWeeks.Add(new WeekWorkoutMisses(
                week, from, to, workoutPlannedPerWeek[i], workoutPlannedPerWeek[i] - missedInWeek.Count, missedInWeek));
        }

        var workoutPlanned = workoutPlannedPerWeek.Sum();

        return new AdherenceResult(
            new DietErrorRate(new Rate(plannedTotal, doneTotal, ErrorPct(plannedTotal, doneTotal)), weekRates),
            wrongMeals,
            dietDeviations,
            new WorkoutMisses(workoutPlanned, workoutPlanned - missedWorkoutDates.Count, missedWorkoutDates, workoutWeeks),
            CardioOf(input.Cardio, weeks, cardioDaysPerWeek, cardioDonePerWeek),
            itemsMissed,
            itemsUsed);
    }

    /// <summary>Daily cardio: every day with the target. Otherwise per week <c>min(sessionsPerWeek, days with the target)</c>.</summary>
    private static CardioMisses CardioOf(
        CardioPlanDto? cardio, IReadOnlyList<(int Week, DateOnly From, DateOnly To)> weeks, int[] daysPerWeek, int[] donePerWeek)
    {
        var weekly = cardio is { Daily: not true, SessionsPerWeek: { } perWeek } ? perWeek : (int?)null;
        var byWeek = new List<WeekCardioMisses>();
        for (var i = 0; i < daysPerWeek.Length; i++)
        {
            var p = weekly is { } n ? Math.Min(Math.Max(n, 0), daysPerWeek[i]) : daysPerWeek[i];
            if (p == 0)
                continue;
            var (week, from, to) = weeks[i];
            byWeek.Add(new WeekCardioMisses(week, from, to, p, Math.Min(donePerWeek[i], p)));
        }

        return new CardioMisses(byWeek.Sum(w => w.Planned), byWeek.Sum(w => w.Done), byWeek);
    }

    private static string ReasonOf(AdherenceLog? log) => log is null ? Unmarked : string.IsNullOrEmpty(log.Reason) ? NoReason : log.Reason;

    private static void Increment(Dictionary<string, int> counts, string reason) =>
        counts[reason] = counts.GetValueOrDefault(reason) + 1;

    private static List<ReasonCount> Sorted(Dictionary<string, int> counts) =>
        counts.OrderByDescending(c => c.Value).ThenBy(c => c.Key, StringComparer.Ordinal)
            .Select(c => new ReasonCount(c.Key, c.Value))
            .ToList();

    private static int? ErrorPct(int planned, int done) =>
        planned == 0 ? null : (int)Math.Round(100m * (planned - done) / planned, MidpointRounding.AwayFromZero);
}
