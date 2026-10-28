using ProtocoloApp.Api.Features.Integrations.Hevy;

namespace ProtocoloApp.UnitTests.Integrations;

public sealed class HevyConnectionsTests
{
    [Theory]
    [InlineData("test-key-0000-0000-0000-000000000001", "0001")]
    [InlineData("abcdefgh", "efgh")]
    [InlineData("abcde", "bcde")]
    [InlineData("abc", "abc")]
    public void Last4_is_never_empty(string key, string expected)
    {
        Assert.Equal(expected, HevyConnections.Last4(key));
    }

    [Theory]
    [InlineData("incomplete", HevyErrorCode.Incomplete)]
    [InlineData("internal", HevyErrorCode.Internal)]
    [InlineData("key_unreadable", HevyErrorCode.KeyUnreadable)]
    public void Stored_run_codes_are_shown_in_the_status(string code, HevyErrorCode expected)
    {
        Assert.Equal(expected, HevyConnections.ParseError(code));
    }

    [Fact]
    public void The_run_codes_match_what_the_status_parses()
    {
        Assert.Equal(HevyErrorCode.Incomplete, HevyConnections.ParseError(HevyRunResult.Incomplete));
        Assert.Equal(HevyErrorCode.Internal, HevyConnections.ParseError(HevyRunResult.Internal));
        Assert.All(new[] { HevyRunResult.Incomplete, HevyRunResult.Internal }, c => Assert.True(c.Length <= HevyConnection.MaxLastErrorLength));
    }
}
