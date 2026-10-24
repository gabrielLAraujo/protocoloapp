using ProtocoloApp.Api.Features.Workouts;

namespace ProtocoloApp.UnitTests.Workouts;

public sealed class SetLogRpeValidatorTests
{
    private static readonly SetLogPayloadValidator Validator = new();

    private static readonly SetLogPayload Valid = new()
    {
        SessionId = Guid.NewGuid(),
        ExerciseId = Guid.NewGuid(),
        PlannedExerciseKey = "bench",
        SetIndex = 0,
        WeightKg = 60m,
        Reps = 10,
        Kind = "normal",
        ParentSetId = null,
        CompletedAt = new DateTimeOffset(2026, 3, 10, 12, 0, 0, TimeSpan.Zero),
        Rpe = null,
    };

    private static List<string> Errors(SetLogPayload payload) =>
        Validator.Validate(payload).Errors.Select(e => e.PropertyName).Distinct().ToList();

    [Fact]
    public void Missing_rpe_passes()
    {
        Assert.Empty(Errors(Valid));
    }

    [Theory]
    [InlineData(1.0)]
    [InlineData(8.5)]
    [InlineData(10.0)]
    public void Rpe_in_half_steps_from_1_to_10_passes(double rpe)
    {
        Assert.Empty(Errors(Valid with { Rpe = (decimal)rpe }));
    }

    [Theory]
    [InlineData(0.5)]
    [InlineData(10.5)]
    [InlineData(7.25)]
    [InlineData(0.0)]
    [InlineData(-1.0)]
    public void Rpe_out_of_range_or_not_a_half_step_is_invalid(double rpe)
    {
        Assert.Equal(["rpe"], Errors(Valid with { Rpe = (decimal)rpe }));
    }
}
