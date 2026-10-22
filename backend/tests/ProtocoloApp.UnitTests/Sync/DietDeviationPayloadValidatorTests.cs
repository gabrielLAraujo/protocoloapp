using ProtocoloApp.Api.Features.DietDeviations;

namespace ProtocoloApp.UnitTests.Sync;

public sealed class DietDeviationPayloadValidatorTests
{
    private static readonly DietDeviationPayloadValidator Validator = new();

    private static readonly DietDeviationPayload Valid = new()
    {
        Date = new DateOnly(2026, 2, 3),
        MealKey = "1",
        Time = null,
        Description = "Biscoito",
        Quantity = "3 unidades",
    };

    private static List<string> Errors(DietDeviationPayload payload) =>
        Validator.Validate(payload).Errors.Select(e => e.PropertyName).Distinct().ToList();

    [Fact]
    public void Valid_payload_passes()
    {
        Assert.Empty(Errors(Valid));
    }

    [Fact]
    public void Extra_meal_without_key_and_with_time_passes()
    {
        Assert.Empty(Errors(Valid with { MealKey = null, Time = "15:30", Quantity = null }));
    }

    [Fact]
    public void Date_is_required()
    {
        Assert.Equal(["date"], Errors(Valid with { Date = null }));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Description_is_required(string? description)
    {
        Assert.Equal(["description"], Errors(Valid with { Description = description }));
    }

    [Fact]
    public void Description_length_limit_is_200()
    {
        Assert.Empty(Errors(Valid with { Description = new string('x', 200) }));
        Assert.Equal(["description"], Errors(Valid with { Description = new string('x', 201) }));
    }

    [Fact]
    public void Quantity_length_limit_is_60()
    {
        Assert.Empty(Errors(Valid with { Quantity = new string('q', 60) }));
        Assert.Equal(["quantity"], Errors(Valid with { Quantity = new string('q', 61) }));
    }

    [Theory]
    [InlineData("7:00")]
    [InlineData("24:00")]
    [InlineData("07:60")]
    [InlineData("07:00:00")]
    [InlineData("")]
    [InlineData("07:00\n")]
    public void Time_must_be_hh_mm(string time)
    {
        Assert.Equal(["time"], Errors(Valid with { Time = time }));
    }

    [Theory]
    [InlineData("")]
    [InlineData("a b")]
    [InlineData("1\n")]
    public void Meal_key_must_be_a_key(string key)
    {
        Assert.Equal(["meal_key"], Errors(Valid with { MealKey = key }));
    }
}
