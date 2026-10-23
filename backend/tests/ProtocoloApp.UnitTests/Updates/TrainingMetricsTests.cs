using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Updates.Metrics;
using ProtocoloApp.Api.Features.Workouts;

namespace ProtocoloApp.UnitTests.Updates;

/// <summary>Same cases and numbers as <c>strengthByGroup</c> in <c>frontend/src/domain/strength.test.ts</c> (fictitious data).</summary>
public sealed class TrainingMetricsTests
{
    private static readonly Dictionary<string, Guid> Ids = [];

    private static Guid Id(string name)
    {
        if (!Ids.TryGetValue(name, out var id))
            Ids[name] = id = Guid.NewGuid();
        return id;
    }

    private static SetLog Set(string sessionId, string exerciseId, decimal weightKg, int reps, SetKind kind = SetKind.Normal) => new()
    {
        Id = Guid.NewGuid(),
        SessionId = Id(sessionId),
        ExerciseId = Id(exerciseId),
        WeightKg = weightKg,
        Reps = reps,
        Kind = kind,
    };

    private static WorkoutSession Session(string id, string date) => new()
    {
        Id = Id(id),
        Date = DateOnly.Parse(date),
        WorkoutDayKey = "A",
        StartedAt = DateTimeOffset.Parse($"{date}T10:00:00Z"),
    };

    private static Exercise Ex(string id, string name, MuscleGroup group) => new() { Id = Id(id), Name = name, PrimaryMuscleGroup = group };

    private static readonly Exercise[] Exercises =
        [Ex("bench", "Supino", MuscleGroup.Chest), Ex("fly", "Crucifixo", MuscleGroup.Chest), Ex("row", "Remada", MuscleGroup.Back)];

    private static readonly WorkoutSession[] Sessions = [Session("s1", "2026-10-20"), Session("s2", "2026-10-27"), Session("s3", "2026-11-03")];

    private static decimal R2(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    [Fact]
    public void E1rm_uses_epley()
    {
        Assert.Equal(133.33m, R2(TrainingMetrics.E1rm(100, 10)));
        Assert.Equal(0m, TrainingMetrics.E1rm(100, 0));
        Assert.Equal(103.33m, R2(TrainingMetrics.E1rm(100, 1)));
    }

    [Fact]
    public void Single_session_has_no_data()
    {
        var output = TrainingMetrics.StrengthChanges([Sessions[0]], [Set("s1", "bench", 100, 10)], Exercises);

        Assert.Empty(output);
    }

    [Fact]
    public void Empty_cycle_gives_no_groups()
    {
        Assert.Empty(TrainingMetrics.StrengthChanges([], [], Exercises));
    }

    [Fact]
    public void Uses_first_vs_last_session_and_the_best_non_warmup_set_of_each()
    {
        SetLog[] sets =
        [
            Set("s1", "bench", 100, 10), Set("s1", "bench", 150, 10, SetKind.Warmup),
            Set("s2", "bench", 105, 10),
            Set("s3", "bench", 110, 10),
            Set("s1", "fly", 40, 10), Set("s3", "fly", 30, 10),
            Set("s1", "row", 80, 10),
        ];

        var output = TrainingMetrics.StrengthChanges(Sessions, sets, Exercises);

        var chest = Assert.Single(output);
        Assert.Equal(MuscleGroup.Chest, chest.Group);
        Assert.Equal([Id("bench"), Id("fly")], chest.Best.Select(t => t.ExerciseId));
        var bench = chest.Best[0];
        Assert.Equal("Supino", bench.Name);
        Assert.Equal(133.33m, bench.FirstE1rm);
        Assert.Equal(146.67m, bench.LastE1rm);
        Assert.Equal(R2(TrainingMetrics.E1rm(110, 10) - TrainingMetrics.E1rm(100, 10)), bench.Delta);
        Assert.Equal(3, bench.Sessions);
        Assert.Equal(-13.33m, chest.Best[1].Delta);
        Assert.Empty(chest.Worst);
        Assert.DoesNotContain(output, g => g.Group == MuscleGroup.Back); // one session only
    }

    [Fact]
    public void Splits_best_two_and_worst_two()
    {
        var ex = new[] { "a", "b", "c", "d", "e" }.Select(id => Ex(id, id, MuscleGroup.Quads)).ToList();
        var gains = new Dictionary<string, decimal> { ["a"] = 50, ["b"] = 40, ["c"] = 10, ["d"] = -5, ["e"] = -20 };
        var sets = ex.SelectMany(e => new[] { Set("s1", e.Name, 100, 10), Set("s2", e.Name, 100 + gains[e.Name], 10) }).ToList();

        var output = TrainingMetrics.StrengthChanges([Sessions[0], Sessions[1]], sets, ex);

        var quads = Assert.Single(output);
        Assert.Equal([Id("a"), Id("b")], quads.Best.Select(t => t.ExerciseId));
        Assert.Equal([Id("e"), Id("d")], quads.Worst.Select(t => t.ExerciseId));
    }

    [Fact]
    public void Worst_only_holds_negative_deltas()
    {
        var ex = new[] { "pa", "pb", "pc" }.Select(id => Ex(id, id, MuscleGroup.Back)).ToList();
        var sets = ex.SelectMany((e, i) => new[] { Set("s1", e.Name, 100, 10), Set("s2", e.Name, 100 + (i + 1) * 5, 10) }).ToList();

        var back = Assert.Single(TrainingMetrics.StrengthChanges([Sessions[0], Sessions[1]], sets, ex));

        Assert.Equal(2, back.Best.Count);
        Assert.Empty(back.Worst);
    }

    [Fact]
    public void Sub_sets_and_warmups_never_count()
    {
        var parent = Set("s1", "bench", 90, 5);
        var sub = Set("s1", "bench", 120, 12, SetKind.RestPause);
        sub.ParentSetId = parent.Id;
        SetLog[] sets = [parent, sub, Set("s2", "bench", 300, 1, SetKind.Warmup), Set("s2", "bench", 90, 5)];

        var chest = Assert.Single(TrainingMetrics.StrengthChanges([Sessions[0], Sessions[1]], sets, Exercises));

        Assert.Equal(0m, chest.Best[0].Delta);
        Assert.Equal(R2(TrainingMetrics.E1rm(90, 5)), chest.Best[0].FirstE1rm);
    }

    [Fact]
    public void Orders_sessions_by_date_then_start()
    {
        var late = Session("late", "2026-10-20");
        late.StartedAt = late.StartedAt.AddHours(5);
        var early = Session("early", "2026-10-20");
        SetLog[] sets = [Set("late", "row", 100, 10), Set("early", "row", 80, 10)];

        var back = Assert.Single(TrainingMetrics.StrengthChanges([late, early], sets, Exercises));

        Assert.Equal(R2(TrainingMetrics.E1rm(80, 10)), back.Best[0].FirstE1rm);
        Assert.True(back.Best[0].Delta > 0);
    }

    [Fact]
    public void Groups_come_in_enum_order()
    {
        SetLog[] sets = [Set("s1", "row", 80, 10), Set("s2", "row", 85, 10), Set("s1", "bench", 100, 10), Set("s2", "bench", 90, 10)];

        var output = TrainingMetrics.StrengthChanges([Sessions[0], Sessions[1]], sets, [Exercises[2], Exercises[0]]);

        Assert.Equal([MuscleGroup.Chest, MuscleGroup.Back], output.Select(g => g.Group));
    }

    [Fact]
    public void Changes_list_swaps_skips_and_activations_by_date()
    {
        var plan = Guid.NewGuid();
        var swap = new ExerciseChange { Action = ExerciseChangeAction.Swapped, PlannedExerciseKey = "ex1", ReplacementExerciseId = Guid.NewGuid() };
        var skip = new ExerciseChange { Action = ExerciseChangeAction.Skipped, PlannedExerciseKey = "ex2" };
        var deleted = new ExerciseChange { Action = ExerciseChangeAction.Skipped, PlannedExerciseKey = "ex3", DeletedAt = DateTimeOffset.UnixEpoch };

        var output = TrainingMetrics.Changes(
            [(new DateOnly(2026, 10, 25), plan)],
            [
                (new DateOnly(2026, 10, 28), skip, "Exercício B", null),
                (new DateOnly(2026, 10, 21), swap, "Exercício A", "Exercício C"),
                (new DateOnly(2026, 10, 25), deleted, "Exercício D", null),
            ]);

        Assert.Equal(
            [
                new TrainingChange(new DateOnly(2026, 10, 21), TrainingChangeKind.Swapped, "Exercício A", "Exercício C"),
                new TrainingChange(new DateOnly(2026, 10, 25), TrainingChangeKind.PlanActivated, null, null),
                new TrainingChange(new DateOnly(2026, 10, 28), TrainingChangeKind.Skipped, "Exercício B", null),
            ],
            output);
    }

    [Fact]
    public void Changes_on_an_empty_cycle_are_empty()
    {
        Assert.Empty(TrainingMetrics.Changes([], []));
    }
}
