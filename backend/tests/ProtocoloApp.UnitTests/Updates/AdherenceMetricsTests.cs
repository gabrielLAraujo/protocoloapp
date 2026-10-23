using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.DietDeviations;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;
using ProtocoloApp.Api.Features.Updates.Metrics;

namespace ProtocoloApp.UnitTests.Updates;

/// <summary>Adherence fill metrics over fictitious days, logs and deviations.</summary>
public sealed class AdherenceMetricsTests
{
    // A Monday, so week blocks are easy to read.
    private static readonly DateOnly Start = new(2026, 1, 5);

    private static readonly IReadOnlyDictionary<string, string> Labels =
        new Dictionary<string, string> { ["m1"] = "REF 1", ["m2"] = "REF 2" };

    [Fact]
    public void Split_makes_seven_day_blocks_with_a_short_last_week()
    {
        var weeks = CycleWeeks.Split(Start, Start.AddDays(14));

        var expected = new (int Week, DateOnly From, DateOnly To)[]
        {
            (1, Start, Start.AddDays(6)), (2, Start.AddDays(7), Start.AddDays(13)), (3, Start.AddDays(14), Start.AddDays(14)),
        };
        Assert.Equal(expected, weeks);
    }

    [Fact]
    public void Split_is_empty_when_from_is_after_to()
    {
        Assert.Empty(CycleWeeks.Split(Start, Start.AddDays(-1)));
        Assert.Single(CycleWeeks.Split(Start, Start));
    }

    [Fact]
    public void Empty_cycle_gives_empty_metrics()
    {
        // Protocol activated today: nothing marked yet.
        var plan = Plan(DayKind.Training, Meal("m1"), Meal("m2"), Item("vit_c"), Cardio());
        var result = AdherenceMetrics.Compute(Input([(Start, plan)], today: Start, cardio: new CardioPlanDto { Daily = true }));

        Assert.Equal(new Rate(0, 0, null), result.DietErrorPct.Cycle);
        Assert.Empty(result.DietErrorPct.Weeks);
        Assert.Empty(result.DietWrongMeals);
        Assert.Empty(result.DietDeviations);
        Assert.Equal(0, result.MissedWorkouts.Planned);
        Assert.Equal(0, result.MissedWorkouts.Done);
        Assert.Empty(result.MissedWorkouts.MissedDates);
        AssertCardio(result, 0, 0);
        Assert.Empty(result.ItemsMissed);
        Assert.Empty(result.ItemsUsed);
        Assert.Empty(result.MissedWorkouts.Weeks);
        Assert.Empty(result.MissedCardio.Weeks);
    }

    [Fact]
    public void No_days_at_all_gives_empty_metrics()
    {
        var result = AdherenceMetrics.Compute(Input([], today: Start));

        Assert.Equal(new Rate(0, 0, null), result.DietErrorPct.Cycle);
        Assert.Empty(result.DietWrongMeals);
        AssertCardio(result, 0, 0);
    }

    [Fact]
    public void Partial_missed_unmarked_and_deviation_are_diet_errors()
    {
        // 5 past days × 2 meals = 10: 7 done, 1 partial, 1 missed, 1 unmarked; plus 1 deviation.
        var days = Enumerable.Range(0, 5).Select(i => (Start.AddDays(i), Plan(DayKind.Off, Meal("m1"), Meal("m2")))).ToList();
        var logs = new List<AdherenceLog>();
        for (var i = 0; i < 4; i++)
        {
            logs.Add(Log(Start.AddDays(i), AdherenceTargetType.Meal, "m1", AdherenceStatus.Done));
            if (i < 3)
                logs.Add(Log(Start.AddDays(i), AdherenceTargetType.Meal, "m2", AdherenceStatus.Done));
        }

        logs.Add(Log(Start.AddDays(3), AdherenceTargetType.Meal, "m2", AdherenceStatus.Partial, "no_time"));
        logs.Add(Log(Start.AddDays(4), AdherenceTargetType.Meal, "m1", AdherenceStatus.Missed, "free_meal"));
        // Start+4 m2: unmarked.
        var deviation = new DietDeviation
        {
            Date = Start.AddDays(1), MealKey = "m2", Time = new TimeOnly(15, 30), Description = "Bolo de exemplo", Quantity = "1 fatia",
        };

        var result = AdherenceMetrics.Compute(Input(days, today: Start.AddDays(5), logs: logs, deviations: [deviation]));

        Assert.Equal(new Rate(11, 7, 36), result.DietErrorPct.Cycle);
        var week = Assert.Single(result.DietWrongMeals);
        Assert.Equal(4, week.Count);
        Assert.Equal(
            new[] { new ReasonCount("deviation", 1), new ReasonCount("free_meal", 1), new ReasonCount("no_time", 1), new ReasonCount("unmarked", 1) },
            week.Reasons);
        var entry = Assert.Single(result.DietDeviations);
        Assert.Equal(
            new DietDeviationEntry(Start.AddDays(1), "m2", "REF 2", new TimeOnly(15, 30), "Bolo de exemplo", "1 fatia"), entry);
    }

    [Fact]
    public void Extra_meal_deviation_has_no_label_and_deviations_are_ordered()
    {
        var days = Enumerable.Range(0, 3).Select(i => (Start.AddDays(i), Plan(DayKind.Off, Meal("m1")))).ToList();
        DietDeviation[] deviations =
        [
            new() { Date = Start.AddDays(2), Description = "Extra B" },
            new() { Date = Start, MealKey = "m1", Description = "A sem hora" },
            new() { Date = Start, Time = new TimeOnly(10, 0), Description = "A com hora" },
            new() { Date = Start.AddDays(9), Description = "Fora do ciclo" },
        ];

        var result = AdherenceMetrics.Compute(Input(days, today: Start.AddDays(3), deviations: deviations));

        Assert.Equal(new[] { "A com hora", "A sem hora", "Extra B" }, result.DietDeviations.Select(d => d.Description));
        Assert.Null(result.DietDeviations[0].MealLabel);
        Assert.Equal("REF 1", result.DietDeviations[1].MealLabel);
        Assert.Equal(new Rate(6, 0, 100), result.DietErrorPct.Cycle);
    }

    [Fact]
    public void Weeks_are_split_from_the_first_day_with_a_short_last_week()
    {
        // 10 days, one meal each, all done except one in week 2.
        var days = Enumerable.Range(0, 10).Select(i => (Start.AddDays(i), Plan(DayKind.Off, Meal("m1")))).ToList();
        var logs = Enumerable.Range(0, 10)
            .Where(i => i != 8)
            .Select(i => Log(Start.AddDays(i), AdherenceTargetType.Meal, "m1", AdherenceStatus.Done))
            .ToList();
        logs.Add(Log(Start.AddDays(8), AdherenceTargetType.Meal, "m1", AdherenceStatus.Missed, "no_appetite"));

        var result = AdherenceMetrics.Compute(Input(days, today: Start.AddDays(10), logs: logs));

        Assert.Equal(
            new[] { new WeekRate(1, Start, Start.AddDays(6), 7, 7, 0), new WeekRate(2, Start.AddDays(7), Start.AddDays(9), 3, 2, 33) },
            result.DietErrorPct.Weeks);
        Assert.Equal(new Rate(10, 9, 10), result.DietErrorPct.Cycle);
        Assert.Equal(new[] { 0, 1 }, result.DietWrongMeals.Select(w => w.Count));
        Assert.Equal(new[] { new ReasonCount("no_appetite", 1) }, result.DietWrongMeals[1].Reasons);
        Assert.Empty(result.DietWrongMeals[0].Reasons);
    }

    [Fact]
    public void Today_counts_only_marked_targets()
    {
        var plan = Plan(DayKind.Training, Meal("m1"), Meal("m2"), Item("vit_c"));
        AdherenceLog[] logs =
        [
            Log(Start, AdherenceTargetType.Meal, "m1", AdherenceStatus.Done),
            Log(Start, AdherenceTargetType.Meal, "m2", AdherenceStatus.Done),
            Log(Start, AdherenceTargetType.ProtocolItem, "vit_c", AdherenceStatus.Done),
            // Today: m1 partial, m2 and the item unmarked; no workout yet.
            Log(Start.AddDays(1), AdherenceTargetType.Meal, "m1", AdherenceStatus.Partial, "no_time"),
        ];

        var result = AdherenceMetrics.Compute(Input(
            [(Start, plan), (Start.AddDays(1), plan)], today: Start.AddDays(1), logs: logs, workedOut: [Start]));

        Assert.Equal(new Rate(3, 2, 33), result.DietErrorPct.Cycle);
        Assert.Equal(new[] { new ReasonCount("no_time", 1) }, Assert.Single(result.DietWrongMeals).Reasons);
        Assert.Empty(result.ItemsMissed);
        Assert.Equal(1, result.MissedWorkouts.Planned);
        Assert.Equal(1, result.MissedWorkouts.Done);
        Assert.Empty(result.MissedWorkouts.MissedDates);
    }

    [Fact]
    public void Days_after_today_are_ignored()
    {
        var plan = Plan(DayKind.Training, Meal("m1"));
        var result = AdherenceMetrics.Compute(Input([(Start, plan), (Start.AddDays(1), plan)], today: Start.AddDays(-1)));

        Assert.Equal(new Rate(0, 0, null), result.DietErrorPct.Cycle);
        Assert.Equal(0, result.MissedWorkouts.Planned);
    }

    [Fact]
    public void Items_missed_group_ran_out_and_unmarked_and_skip_partial()
    {
        var plan = Plan(DayKind.Off, Item("vit_c", "Vitamina C"), Item("omega", "Ômega 3"), Item("zinc", "Zinco"));
        AdherenceLog[] logs =
        [
            Log(Start, AdherenceTargetType.ProtocolItem, "vit_c", AdherenceStatus.Missed, AdherenceLog.RanOut),
            Log(Start.AddDays(1), AdherenceTargetType.ProtocolItem, "vit_c", AdherenceStatus.Missed, AdherenceLog.RanOut),
            Log(Start, AdherenceTargetType.ProtocolItem, "zinc", AdherenceStatus.Partial, "no_time"),
            Log(Start.AddDays(1), AdherenceTargetType.ProtocolItem, "zinc", AdherenceStatus.Done),
            Log(Start.AddDays(1), AdherenceTargetType.ProtocolItem, "omega", AdherenceStatus.Missed),
            // omega on Start: unmarked.
        ];

        var result = AdherenceMetrics.Compute(Input([(Start, plan), (Start.AddDays(1), plan)], today: Start.AddDays(2), logs: logs));

        Assert.Equal(2, result.ItemsMissed.Count);
        Assert.Equal("omega", result.ItemsMissed[0].Key);
        Assert.Equal("Ômega 3", result.ItemsMissed[0].Name);
        Assert.Equal(2, result.ItemsMissed[0].Missed);
        Assert.Equal(new[] { new ReasonCount("other", 1), new ReasonCount("unmarked", 1) }, result.ItemsMissed[0].Reasons);
        Assert.Equal("vit_c", result.ItemsMissed[1].Key);
        Assert.Equal("Vitamina C", result.ItemsMissed[1].Name);
        Assert.Equal(2, result.ItemsMissed[1].Missed);
        Assert.Equal(new[] { new ReasonCount("ran_out", 2) }, result.ItemsMissed[1].Reasons);
    }

    [Fact]
    public void Items_carry_their_category_and_used_items_count_done_partial_and_planned_days()
    {
        var plan = Plan(DayKind.Off, Item("vit_c", "Vitamina C"), Item("omega", "Ômega 3"), Item("zinc", "Zinco"), Item("gone", "Antigo"));
        AdherenceLog[] logs =
        [
            Log(Start, AdherenceTargetType.ProtocolItem, "vit_c", AdherenceStatus.Done),
            Log(Start.AddDays(1), AdherenceTargetType.ProtocolItem, "vit_c", AdherenceStatus.Partial, "no_time"),
            Log(Start.AddDays(2), AdherenceTargetType.ProtocolItem, "vit_c", AdherenceStatus.Done),
            Log(Start, AdherenceTargetType.ProtocolItem, "zinc", AdherenceStatus.Partial),
            Log(Start.AddDays(1), AdherenceTargetType.ProtocolItem, "gone", AdherenceStatus.Done),
            // omega: never marked on the past days; today (Start+2) only vit_c is marked.
        ];
        var categories = new Dictionary<string, string> { ["vit_c"] = "supplement", ["omega"] = "compound", ["zinc"] = "hormone" };

        var result = AdherenceMetrics.Compute(Input(
            [(Start, plan), (Start.AddDays(1), plan), (Start.AddDays(2), plan)],
            today: Start.AddDays(2),
            logs: logs,
            itemCategories: categories));

        Assert.Equal(
            new[]
            {
                new ItemUse("vit_c", "Vitamina C", "supplement", 2, 1, 3),
                new ItemUse("zinc", "Zinco", "hormone", 0, 1, 2),
                new ItemUse("gone", "Antigo", null, 1, 0, 2),
            },
            result.ItemsUsed);
        Assert.Equal(new[] { "omega", "gone", "zinc" }, result.ItemsMissed.Select(i => i.Key));
        Assert.Equal(new string?[] { "compound", null, "hormone" }, result.ItemsMissed.Select(i => i.Category));
    }

    [Fact]
    public void Without_categories_items_have_none()
    {
        var plan = Plan(DayKind.Off, Item("vit_c"));
        AdherenceLog[] logs = [Log(Start, AdherenceTargetType.ProtocolItem, "vit_c", AdherenceStatus.Done)];

        var result = AdherenceMetrics.Compute(Input([(Start, plan), (Start.AddDays(1), plan)], today: Start.AddDays(2), logs: logs));

        Assert.Null(Assert.Single(result.ItemsUsed).Category);
        Assert.Null(Assert.Single(result.ItemsMissed).Category);
    }

    [Fact]
    public void Missed_workouts_are_split_by_week_without_empty_weeks()
    {
        // Week 1: training on Start and Start+2 (one missed); week 2: no training day; week 3: Start+14 missed.
        var days = Enumerable.Range(0, 15)
            .Select(i => (Start.AddDays(i), Plan(i is 0 or 2 or 14 ? DayKind.Training : DayKind.Off)))
            .ToList();

        var result = AdherenceMetrics.Compute(Input(days, today: Start.AddDays(15), workedOut: [Start]));

        Assert.Equal(3, result.MissedWorkouts.Planned);
        Assert.Equal(1, result.MissedWorkouts.Done);
        var weeks = result.MissedWorkouts.Weeks;
        Assert.Equal(new[] { 1, 3 }, weeks.Select(w => w.Week));
        Assert.Equal((Start, Start.AddDays(6), 2, 1), (weeks[0].From, weeks[0].To, weeks[0].Planned, weeks[0].Done));
        Assert.Equal(new[] { Start.AddDays(2) }, weeks[0].MissedDates);
        Assert.Equal((Start.AddDays(14), Start.AddDays(14), 1, 0), (weeks[1].From, weeks[1].To, weeks[1].Planned, weeks[1].Done));
        Assert.Equal(new[] { Start.AddDays(14) }, weeks[1].MissedDates);
    }

    [Fact]
    public void Weekly_cardio_has_a_line_per_week_that_adds_up_to_the_cycle()
    {
        // Same as below: week 1, 7 days, 1 done; week 2, 2 days, none done; 3 sessions a week.
        var days = Enumerable.Range(0, 9).Select(i => (Start.AddDays(i), Plan(DayKind.Off, Cardio()))).ToList();
        AdherenceLog[] logs = [Log(Start, AdherenceTargetType.Cardio, DayPlanner.CardioKey, AdherenceStatus.Done)];

        var result = AdherenceMetrics.Compute(Input(
            days, today: Start.AddDays(9), logs: logs, cardio: new CardioPlanDto { SessionsPerWeek = 3 }));

        Assert.Equal(
            new[] { new WeekCardioMisses(1, Start, Start.AddDays(6), 3, 1), new WeekCardioMisses(2, Start.AddDays(7), Start.AddDays(8), 2, 0) },
            result.MissedCardio.Weeks);
    }

    [Fact]
    public void Weekly_cardio_caps_done_at_the_sessions_per_week()
    {
        // 7 days with the cardio target, 3 sessions a week: 5 done (3 by the mark, 2 by the check-in).
        var days = Enumerable.Range(0, 7).Select(i => (Start.AddDays(i), Plan(DayKind.Off, Cardio()))).ToList();
        var logs = Enumerable.Range(0, 3)
            .Select(i => Log(Start.AddDays(i), AdherenceTargetType.Cardio, DayPlanner.CardioKey, AdherenceStatus.Done))
            .ToList();
        DailyCheckin[] checkins = [new() { Date = Start.AddDays(3), CardioDone = true }, new() { Date = Start.AddDays(4), CardioDone = true }];

        var result = AdherenceMetrics.Compute(Input(
            days, today: Start.AddDays(7), logs: logs, checkins: checkins, cardio: new CardioPlanDto { SessionsPerWeek = 3 }));

        AssertCardio(result, 3, 3);
    }

    [Fact]
    public void Weekly_cardio_plans_per_week_and_never_more_than_the_days_with_the_target()
    {
        // Week 1: 7 days, 1 done; week 2: 2 days, none done. 3 sessions a week.
        var days = Enumerable.Range(0, 9).Select(i => (Start.AddDays(i), Plan(DayKind.Off, Cardio()))).ToList();
        AdherenceLog[] logs = [Log(Start, AdherenceTargetType.Cardio, DayPlanner.CardioKey, AdherenceStatus.Done)];

        var result = AdherenceMetrics.Compute(Input(
            days, today: Start.AddDays(9), logs: logs, cardio: new CardioPlanDto { SessionsPerWeek = 3 }));

        AssertCardio(result, 5, 1);
    }

    [Fact]
    public void Daily_cardio_plans_every_day_with_the_target()
    {
        var days = Enumerable.Range(0, 3).Select(i => (Start.AddDays(i), Plan(DayKind.Off, Cardio()))).ToList();
        AdherenceLog[] logs =
        [
            Log(Start, AdherenceTargetType.Cardio, DayPlanner.CardioKey, AdherenceStatus.Done),
            Log(Start.AddDays(1), AdherenceTargetType.Cardio, DayPlanner.CardioKey, AdherenceStatus.Partial),
        ];
        DailyCheckin[] checkins = [new() { Date = Start.AddDays(3), CardioDone = true }];

        var result = AdherenceMetrics.Compute(Input(
            [.. days, (Start.AddDays(3), Plan(DayKind.Off, Cardio()))],
            today: Start.AddDays(3), logs: logs, checkins: checkins, cardio: new CardioPlanDto { Daily = true }));

        // Today counts because it is done (by the check-in).
        AssertCardio(result, 4, 2);
    }

    [Fact]
    public void Off_day_does_not_plan_a_workout()
    {
        var training = Plan(DayKind.Training);
        DateOnly[] dates = [Start, Start.AddDays(1), Start.AddDays(2), Start.AddDays(3)];
        var result = AdherenceMetrics.Compute(Input(
            [(dates[0], training), (dates[1], Plan(DayKind.Off)), (dates[2], training), (dates[3], Plan(DayKind.None))],
            today: Start.AddDays(4),
            workedOut: [dates[0], dates[1]]));

        Assert.Equal(2, result.MissedWorkouts.Planned);
        Assert.Equal(1, result.MissedWorkouts.Done);
        Assert.Equal(new[] { dates[2] }, result.MissedWorkouts.MissedDates);
    }

    private static AdherenceInput Input(
        IReadOnlyList<(DateOnly Date, DayPlan Plan)> days,
        DateOnly today,
        IReadOnlyList<AdherenceLog>? logs = null,
        IReadOnlyList<DietDeviation>? deviations = null,
        IReadOnlyList<DailyCheckin>? checkins = null,
        IEnumerable<DateOnly>? workedOut = null,
        CardioPlanDto? cardio = null,
        IReadOnlyDictionary<string, string>? itemCategories = null) =>
        new(days, today, logs ?? [], deviations ?? [], checkins ?? [], (workedOut ?? []).ToHashSet(), cardio, Labels, itemCategories);

    private static void AssertCardio(AdherenceResult result, int planned, int done) =>
        Assert.Equal((planned, done), (result.MissedCardio.Planned, result.MissedCardio.Done));

    private static DayPlan Plan(DayKind kind, params DayTarget[] targets) =>
        new(kind, kind == DayKind.Training ? "A" : null, targets);

    private static DayTarget Meal(string key) => new(AdherenceTargetType.Meal, key, key, null, null, false);

    private static DayTarget Item(string key, string? name = null) =>
        new(AdherenceTargetType.ProtocolItem, key, name ?? key, null, null, false);

    private static DayTarget Cardio() => new(AdherenceTargetType.Cardio, DayPlanner.CardioKey, "Cardio", null, null, false);

    private static AdherenceLog Log(DateOnly date, AdherenceTargetType type, string key, AdherenceStatus status, string? reason = null) =>
        new() { Id = Guid.NewGuid(), Date = date, TargetType = type, TargetKey = key, Status = status, Reason = reason };
}
