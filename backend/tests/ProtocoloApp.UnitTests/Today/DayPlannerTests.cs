using System.Globalization;
using System.Text.Json;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;

namespace ProtocoloApp.UnitTests.Today;

/// <summary>Runs every case of the shared <c>fixtures/schedule-cases.json</c> (the front runs the same file).</summary>
public sealed class DayPlannerTests
{
    private const string TimeFormat = "HH':'mm";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly Lazy<FixtureFile> Fixture = new(() =>
        JsonSerializer.Deserialize<FixtureFile>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "schedule-cases.json")), Json)!);

    public static TheoryData<string> CaseNames
    {
        get
        {
            var data = new TheoryData<string>();
            foreach (var c in Fixture.Value.Cases)
                data.Add(c.Name);
            return data;
        }
    }

    [Fact]
    public void Fixture_has_at_least_twelve_uniquely_named_cases()
    {
        var names = Fixture.Value.Cases.Select(c => c.Name).ToList();

        Assert.True(names.Count >= 12, $"Only {names.Count} cases.");
        Assert.Equal(names.Count, names.Distinct(StringComparer.Ordinal).Count());
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Builds_the_expected_day(string name)
    {
        var c = Fixture.Value.Cases.Single(x => x.Name == name);
        var input = c.Input;

        var plan = DayPlanner.Build(
            input.Date,
            input.Protocol,
            input.Workouts.Select(w => new WorkoutPlanAt(w.ActivatedAt, w.ActivatedOn, w.Rotation)).ToList(),
            input.Overrides.Select(o => new RotationOverrideRow(o.Date, o.WorkoutDayKey)).ToList(),
            input.Slots.Select(s => new ScheduleSlotRow(
                s.Slot,
                EnumText.Parse<DayType>(s.DayType),
                TimeOnly.ParseExact(s.Time, TimeFormat, CultureInfo.InvariantCulture),
                s.ReminderEnabled)).ToList(),
            input.ProtocolActivatedOn);

        Assert.Equal(c.Expected.DayType, EnumText.ToText(plan.DayType));
        Assert.Equal(c.Expected.WorkoutDayKey, plan.WorkoutDayKey);
        var actual = plan.Targets
            .Select(t => new TargetJson(
                EnumText.ToText(t.Type),
                t.Key,
                t.Label,
                t.SlotKey,
                t.Time?.ToString(TimeFormat, CultureInfo.InvariantCulture),
                t.ReminderEnabled))
            .ToList();
        Assert.Equal(c.Expected.Targets, actual);
    }

    private sealed record FixtureFile(IReadOnlyList<CaseJson> Cases);

    private sealed record CaseJson(string Name, string Description, InputJson Input, ExpectedJson Expected);

    private sealed record InputJson(
        DateOnly Date,
        ProtocolDocument? Protocol,
        DateOnly? ProtocolActivatedOn,
        IReadOnlyList<WorkoutJson> Workouts,
        IReadOnlyList<OverrideJson> Overrides,
        IReadOnlyList<SlotJson> Slots);

    private sealed record WorkoutJson(string PlanVersionId, DateTimeOffset ActivatedAt, DateOnly ActivatedOn, RotationDto? Rotation);

    private sealed record OverrideJson(DateOnly Date, string WorkoutDayKey);

    private sealed record SlotJson(string Slot, string DayType, string Time, bool ReminderEnabled);

    private sealed record ExpectedJson(string DayType, string? WorkoutDayKey, IReadOnlyList<TargetJson> Targets);

    private sealed record TargetJson(string Type, string Key, string Label, string? Slot, string? Time, bool ReminderEnabled);
}
