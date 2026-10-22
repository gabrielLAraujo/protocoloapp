using System.Net;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests;

public sealed class HealthTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Health_returns_200_when_database_is_up()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri("/health", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Ready_returns_200_when_database_and_bucket_are_up()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri("/health/ready", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Ready_returns_503_when_bucket_is_unreachable_but_health_stays_up()
    {
        using var client = factory.CreateClient();
        factory.Storage.BucketReachable = false;
        try
        {
            var ready = await client.GetAsync(new Uri("/health/ready", UriKind.Relative));
            var live = await client.GetAsync(new Uri("/health", UriKind.Relative));

            Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
            Assert.Contains("Unhealthy", await ready.Content.ReadAsStringAsync());
            Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        }
        finally
        {
            factory.Storage.BucketReachable = true;
        }
    }

    [Fact]
    public async Task Ready_returns_503_within_seconds_when_the_bucket_check_hangs()
    {
        using var client = factory.CreateClient();
        factory.Storage.HangBucketCheck = true;
        try
        {
            var started = DateTimeOffset.UtcNow;
            var ready = await client.GetAsync(new Uri("/health/ready", UriKind.Relative));

            Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
            Assert.True(DateTimeOffset.UtcNow - started < TimeSpan.FromSeconds(8), "The readiness probe must time out in about 5 s.");
        }
        finally
        {
            factory.Storage.HangBucketCheck = false;
        }
    }

    [Fact]
    public async Task Unknown_api_route_returns_problem_details()
    {
        using var client = factory.CreateClient();

        var response = await client.GetAsync(new Uri("/api/nao-existe", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
