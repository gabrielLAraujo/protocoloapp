using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests;

[Collection("api")]
public sealed class CorsTests(ApiFactory factory)
{
    private static HttpRequestMessage Preflight(string path, string origin)
    {
        var request = new HttpRequestMessage(HttpMethod.Options, new Uri(path, UriKind.Relative));
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "POST");
        request.Headers.Add("Access-Control-Request-Headers", "content-type,authorization");
        return request;
    }

    [Theory]
    [InlineData("https://localhost")]
    [InlineData("capacitor://localhost")]
    public async Task Capacitor_origin_is_allowed(string origin)
    {
        using var client = factory.CreateClientWithOwnIp();

        var response = await client.SendAsync(Preflight("/api/auth/login", origin));

        Assert.True(response.IsSuccessStatusCode, $"Preflight returned {(int)response.StatusCode}.");
        Assert.Equal(origin, Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
    }

    [Fact]
    public async Task Unknown_origin_is_not_allowed()
    {
        using var client = factory.CreateClientWithOwnIp();

        var response = await client.SendAsync(Preflight("/api/auth/login", "https://evil.example"));

        Assert.False(response.Headers.Contains("Access-Control-Allow-Origin"));
    }
}
