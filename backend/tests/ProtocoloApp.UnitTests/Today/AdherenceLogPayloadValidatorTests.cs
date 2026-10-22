using ProtocoloApp.Api.Features.Today;

namespace ProtocoloApp.UnitTests.Today;

public sealed class AdherenceLogPayloadValidatorTests
{
    private static readonly AdherenceLogPayloadValidator Validator = new();

    private static AdherenceLogPayload Payload(string targetType, string status, string? reason) => new()
    {
        Date = new DateOnly(2026, 3, 10),
        TargetType = targetType,
        TargetKey = "item_1",
        Status = status,
        Reason = reason,
    };

    private static List<string> Errors(AdherenceLogPayload payload) =>
        Validator.Validate(payload).Errors.Select(e => e.PropertyName).Distinct().ToList();

    [Theory]
    [InlineData("missed")]
    [InlineData("partial")]
    public void Ran_out_is_accepted_on_a_protocol_item(string status)
    {
        Assert.Empty(Errors(Payload("protocol_item", status, "ran_out")));
    }

    [Theory]
    [InlineData("meal")]
    [InlineData("cardio")]
    [InlineData("workout")]
    [InlineData("checkin")]
    public void Ran_out_is_rejected_on_other_target_types(string targetType)
    {
        Assert.Equal(new[] { "reason" }, Errors(Payload(targetType, "missed", "ran_out")));
    }

    [Fact]
    public void Ran_out_is_rejected_when_done()
    {
        Assert.Equal(new[] { "reason" }, Errors(Payload("protocol_item", "done", "ran_out")));
    }

    [Theory]
    [InlineData("meal")]
    [InlineData("protocol_item")]
    public void Generic_reasons_stay_valid_on_any_target_type(string targetType)
    {
        Assert.Empty(Errors(Payload(targetType, "missed", "no_time")));
    }
}
