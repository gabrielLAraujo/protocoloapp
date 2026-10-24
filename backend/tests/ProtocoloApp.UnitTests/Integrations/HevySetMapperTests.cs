using ProtocoloApp.Api.Features.Integrations.Hevy;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;
using ProtocoloApp.Api.Features.Workouts;

namespace ProtocoloApp.UnitTests.Integrations;

public sealed class HevySetMapperTests
{
    private static readonly Guid User = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly Guid Session = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid Exercise = Guid.Parse("00000000-0000-0000-0000-0000000000e1");
    private static readonly DateTimeOffset Start = new(2026, 3, 10, 13, 0, 0, TimeSpan.Zero);

    private static HevySet Set(int index, string type = "normal", decimal? weight = 40m, int? reps = 10, decimal? rpe = null, int? duration = null) =>
        new(index, type, weight, reps, null, duration, rpe);

    private static (IReadOnlyList<SetLog> Sets, int Skipped) Map(params HevySet[] sets) =>
        HevySetMapper.Map(new HevyExercise("Exercicio Inventado", "TPL00001", null, null, sets), Session, Exercise, "bench", User, Start);

    [Fact]
    public void Types_map_to_kinds_and_a_drop_continues_the_last_normal_set()
    {
        var (sets, skipped) = Map(Set(0, "warmup", 20m), Set(1, "normal"), Set(2, "dropset", 30m, 8), Set(3, "failure"), Set(4, "dropset", 25m, 6));

        Assert.Equal(0, skipped);
        Assert.Equal(new[] { SetKind.Warmup, SetKind.Normal, SetKind.Drop, SetKind.Normal, SetKind.Drop }, sets.Select(s => s.Kind));
        Assert.Equal(new[] { 0, 1, 1, 2, 2 }, sets.Select(s => s.SetIndex));
        Assert.Equal(sets[1].Id, sets[2].ParentSetId);
        Assert.Equal(sets[3].Id, sets[4].ParentSetId);
        Assert.Null(sets[0].ParentSetId);
        Assert.All(sets, s => Assert.Equal("TPL00001", s.HevyTemplateId));
        Assert.All(sets, s => Assert.Equal("bench", s.PlannedExerciseKey));
        Assert.Equal(Enumerable.Range(1, 5).Select(i => Start.AddSeconds(i)), sets.Select(s => s.CompletedAt));
    }

    [Fact]
    public void A_dropset_without_a_set_before_is_normal()
    {
        var (sets, _) = Map(Set(0, "dropset"), Set(1, "dropset"));

        Assert.Equal(SetKind.Normal, sets[0].Kind);
        Assert.Equal(SetKind.Drop, sets[1].Kind);
        Assert.Equal(sets[0].Id, sets[1].ParentSetId);
    }

    [Fact]
    public void Null_weight_is_body_weight()
    {
        var (sets, _) = Map(Set(0, weight: null, reps: 12));

        Assert.Equal(0m, Assert.Single(sets).WeightKg);
        Assert.Equal(12, sets[0].Reps);
    }

    [Fact]
    public void A_set_of_duration_only_and_sets_out_of_range_are_skipped()
    {
        var (sets, skipped) = Map(Set(0, weight: null, reps: null, duration: 60), Set(1, reps: 201), Set(2, weight: 1000.5m), Set(3, reps: 5));

        Assert.Equal(3, skipped);
        var kept = Assert.Single(sets);
        Assert.Equal(0, kept.SetIndex);
        Assert.Equal(5, kept.Reps);
    }

    [Fact]
    public void Sets_beyond_the_last_set_index_are_skipped()
    {
        var (sets, skipped) = Map(Enumerable.Range(0, SetLog.MaxSetIndex + 3).Select(i => Set(i)).ToArray());

        Assert.Equal(SetLog.MaxSetIndex + 1, sets.Count);
        Assert.Equal(2, skipped);
    }

    [Theory]
    [InlineData(11.0, null)]
    [InlineData(0.5, null)]
    [InlineData(7.25, null)]
    [InlineData(8.5, 8.5)]
    [InlineData(10.0, 10.0)]
    [InlineData(1.0, 1.0)]
    public void Rpe_out_of_range_or_off_step_is_null(double rpe, double? expected)
    {
        var (sets, _) = Map(Set(0, rpe: (decimal)rpe));

        Assert.Equal(expected is null ? null : (decimal?)expected, sets[0].Rpe);
    }

    [Fact]
    public void Sets_follow_hevys_index_and_start_at_the_given_set_index()
    {
        var (sets, _) = HevySetMapper.Map(
            new HevyExercise("Exercicio Inventado", "TPL00001", null, null, [Set(1, reps: 8), Set(0, reps: 10)]), Session, Exercise, null, User, Start, 3);

        Assert.Equal(new[] { 10, 8 }, sets.Select(s => s.Reps));
        Assert.Equal(new[] { 3, 4 }, sets.Select(s => s.SetIndex));
        Assert.All(sets, s => Assert.Null(s.PlannedExerciseKey));
    }

    [Theory]
    [InlineData("chest", MuscleGroup.Chest)]
    [InlineData("lats", MuscleGroup.Back)]
    [InlineData("upper_back", MuscleGroup.Back)]
    [InlineData("traps", MuscleGroup.Back)]
    [InlineData("quadriceps", MuscleGroup.Quads)]
    [InlineData("adductors", MuscleGroup.Glutes)]
    [InlineData("abdominals", MuscleGroup.Abs)]
    [InlineData("lower_back", MuscleGroup.LowerBack)]
    [InlineData("cardio", MuscleGroup.Other)]
    [InlineData(null, MuscleGroup.Other)]
    public void Hevy_muscle_groups_map_to_ours(string? hevy, MuscleGroup expected) =>
        Assert.Equal(expected, HevyExerciseLinker.MuscleGroupOf(hevy));

    [Fact]
    public void Adherence_id_matches_the_front()
    {
        // uuid's v5 of "00000000-0000-0000-0000-000000000001:adherence:2026-03-10:workout:workout" in the check-in namespace.
        Assert.Equal(
            Guid.Parse("e9f0f14c-6142-5c67-b42c-f0d4bea6f215"),
            AdherenceIds.For(User, new DateOnly(2026, 3, 10), "workout", "workout"));
    }
}
