using ProtocoloApp.Api.Features.Integrations.Hevy;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;

namespace ProtocoloApp.UnitTests.Integrations;

public sealed class HevyDayResolverTests
{
    private static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo");
    private static readonly Guid ExA = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid ExB = Guid.Parse("00000000-0000-0000-0000-0000000000b1");
    private static readonly Guid ExC = Guid.Parse("00000000-0000-0000-0000-0000000000c1");
    private static readonly DateOnly Activated = new(2026, 3, 1);

    private static readonly WorkoutDocument Doc = new()
    {
        // From the 1st: a, b, off, a, b, off...
        Rotation = new RotationDto { Type = RotationDto.Sequence, Items = ["a", "b", "off"] },
        Days =
        [
            Day("a", "Treino Exemplo A", ExA, ExC),
            Day("b", "Treino Exemplo B", ExB, ExC),
        ],
    };

    private static WorkoutDayDto Day(string key, string name, params Guid[] exercises) => new()
    {
        Key = key,
        Name = name,
        Exercises = exercises.Select((id, i) => new PlannedExerciseDto { Key = $"{key}{i}", ExerciseId = id, Name = $"Exercicio {key}{i}" }).ToList(),
    };

    private static readonly PlanVersion Version = new()
    {
        Id = Guid.Parse("00000000-0000-0000-0000-00000000f001"),
        Kind = PlanKind.Workout,
        ActivatedAt = new DateTimeOffset(2026, 3, 1, 12, 0, 0, TimeSpan.Zero),
    };

    private static (PlanVersion, WorkoutDocument, DateOnly)[] Plans => [(Version, Doc, Activated)];

    private static HevyWorkout Workout(string title, DateTimeOffset? start = null) =>
        new("hevy-0001", title, null, start ?? new DateTimeOffset(2026, 3, 1, 13, 0, 0, TimeSpan.Zero), null, DateTimeOffset.UnixEpoch, []);

    private static string? DayKey(DateOnly date, string title, Guid?[] mapped, params RotationOverrideRow[] overrides) =>
        HevyDayResolver.Resolve(date, Workout(title), mapped, Plans, overrides)?.DayKey;

    [Fact]
    public void Title_equal_to_a_day_name_wins()
    {
        var result = HevyDayResolver.Resolve(new DateOnly(2026, 3, 1), Workout("treino exemplo b"), [ExA], Plans, []);

        Assert.Equal((Version.Id, "b"), result!.Value);
    }

    [Fact]
    public void Overlap_wins_over_the_rotation()
    {
        // The 1st is "a" in the rotation; the workout has B's exercise.
        Assert.Equal("b", DayKey(new DateOnly(2026, 3, 1), "Treino do dia", [ExB, null]));
    }

    [Fact]
    public void A_tie_in_overlap_goes_to_the_rotation_day()
    {
        // ExC is in both days: the 2nd is "b" in the rotation.
        Assert.Equal("b", DayKey(new DateOnly(2026, 3, 2), "Treino do dia", [ExC]));
        Assert.Equal("a", DayKey(new DateOnly(2026, 3, 4), "Treino do dia", [ExC]));
    }

    [Fact]
    public void No_overlap_follows_the_rotation_and_its_overrides()
    {
        Assert.Equal("b", DayKey(new DateOnly(2026, 3, 2), "Treino do dia", [null]));
        Assert.Equal("a", DayKey(new DateOnly(2026, 3, 2), "Treino do dia", [], new RotationOverrideRow(new DateOnly(2026, 3, 2), "a")));
    }

    [Fact]
    public void An_off_day_without_overlap_falls_back_to_the_first_day()
    {
        Assert.Equal("a", DayKey(new DateOnly(2026, 3, 3), "Treino do dia", []));
        Assert.Equal("a", DayKey(new DateOnly(2026, 3, 2), "Treino do dia", [], new RotationOverrideRow(new DateOnly(2026, 3, 2), "off")));
    }

    [Fact]
    public void Before_the_first_activation_there_is_no_plan()
    {
        Assert.Null(HevyDayResolver.Resolve(new DateOnly(2026, 2, 28), Workout("Treino Exemplo A"), [ExA], Plans, []));
    }

    [Fact]
    public void The_latest_activation_up_to_the_date_is_used()
    {
        var newer = new PlanVersion { Id = Guid.NewGuid(), Kind = PlanKind.Workout, ActivatedAt = new DateTimeOffset(2026, 3, 5, 12, 0, 0, TimeSpan.Zero) };
        var newerDoc = new WorkoutDocument { Days = [Day("x", "Treino Novo", ExA)] };
        (PlanVersion, WorkoutDocument, DateOnly)[] plans = [(Version, Doc, Activated), (newer, newerDoc, new DateOnly(2026, 3, 5))];

        Assert.Equal((Version.Id, "a"), HevyDayResolver.Resolve(new DateOnly(2026, 3, 4), Workout("Treino"), [ExA], plans, [])!.Value);
        Assert.Equal((newer.Id, "x"), HevyDayResolver.Resolve(new DateOnly(2026, 3, 5), Workout("Treino"), [ExB], plans, [])!.Value);
    }

    [Fact]
    public void Late_evening_in_Sao_Paulo_stays_on_the_local_date()
    {
        // 23:30 in São Paulo on the 1st is 02:30 UTC on the 2nd.
        var start = new DateTimeOffset(2026, 3, 2, 2, 30, 0, TimeSpan.Zero);
        var date = HevyDayResolver.LocalDate(start, Zone);

        Assert.Equal(new DateOnly(2026, 3, 1), date);
        // The 1st is "a" in the rotation (the 2nd would be "b").
        Assert.Equal("a", HevyDayResolver.Resolve(date, Workout("Treino do dia", start), [], Plans, [])?.DayKey);
        // A plan activated on the 2nd (local) does not apply yet.
        var later = new PlanVersion { Id = Guid.NewGuid(), Kind = PlanKind.Workout, ActivatedAt = new DateTimeOffset(2026, 3, 2, 12, 0, 0, TimeSpan.Zero) };
        Assert.Null(HevyDayResolver.Resolve(date, Workout("Treino", start), [], [(later, Doc, new DateOnly(2026, 3, 2))], []));
    }
}
