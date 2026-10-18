using System.Net;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Auth;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Sync;

[Collection("api")]
public sealed class PullTests(ApiFactory factory)
{
    private static readonly DateOnly Day = new(2026, 4, 1);

    private Task<HttpClient> NewUserAsync() => factory.CreateAuthenticatedClientAsync(AuthApi.NewEmail());

    [Fact]
    public async Task Pull_paginates_by_version()
    {
        using var client = await NewUserAsync();
        var changes = Enumerable.Range(0, 7)
            .Select(i => SyncApi.Checkin(Guid.NewGuid(), Day.AddDays(i), SyncApi.Past()))
            .ToArray();
        Assert.All(await SyncApi.PushAsync(client, changes), r => Assert.Equal(SyncResultStatus.Applied, r.Status));

        var page1 = await SyncApi.PullAsync(client, 0, limit: 3);
        var page2 = await SyncApi.PullAsync(client, page1.NextSince, limit: 3);
        var page3 = await SyncApi.PullAsync(client, page2.NextSince, limit: 3);

        Assert.Equal(new[] { 3, 3, 1 }, new[] { page1, page2, page3 }.Select(p => p.Records.Count));
        Assert.Equal(new[] { true, true, false }, new[] { page1, page2, page3 }.Select(p => p.HasMore));
        foreach (var page in new[] { page1, page2, page3 })
        {
            Assert.Equal(page.Records.Max(r => r.Version), page.NextSince);
            Assert.Equal(page.Records.Select(r => r.Version).Order(), page.Records.Select(r => r.Version));
        }

        Assert.True(page1.NextSince < page2.Records[0].Version);
        Assert.True(page2.NextSince < page3.Records[0].Version);
        var pulled = page1.Records.Concat(page2.Records).Concat(page3.Records).Select(r => r.Id).Order();
        Assert.Equal(changes.Select(c => c.Id).Order(), pulled);
    }

    [Fact]
    public async Task Pull_past_the_end_is_empty_and_keeps_since()
    {
        using var client = await NewUserAsync();
        await SyncApi.PushOneAsync(client, SyncApi.Checkin(Guid.NewGuid(), Day, SyncApi.Past()));
        var first = await SyncApi.PullAsync(client, 0);

        var next = await SyncApi.PullAsync(client, first.NextSince);

        Assert.Empty(next.Records);
        Assert.False(next.HasMore);
        Assert.Equal(first.NextSince, next.NextSince);
    }

    [Fact]
    public async Task Pull_only_returns_current_user_records()
    {
        using var alice = await NewUserAsync();
        using var bob = await NewUserAsync();
        var aliceIds = new[] { Guid.NewGuid(), Guid.NewGuid() };
        var bobId = Guid.NewGuid();

        await SyncApi.PushAsync(alice,
            SyncApi.Checkin(aliceIds[0], Day, SyncApi.Past()),
            SyncApi.Checkin(aliceIds[1], Day.AddDays(1), SyncApi.Past()));
        // Same date as Alice: dates are unique per user, not globally.
        Assert.Equal(SyncResultStatus.Applied, (await SyncApi.PushOneAsync(bob, SyncApi.Checkin(bobId, Day, SyncApi.Past()))).Status);

        var aliceRecords = await SyncApi.PullAllAsync(alice);
        var bobRecords = await SyncApi.PullAllAsync(bob);

        Assert.Equal(aliceIds.Order(), aliceRecords.Select(r => r.Id).Order());
        Assert.Equal(bobId, Assert.Single(bobRecords).Id);
    }

    [Theory]
    [InlineData("since=-1")]
    [InlineData("since=0&limit=0")]
    [InlineData("since=0&limit=501")]
    public async Task Invalid_pull_parameters_return_400(string query)
    {
        using var client = await NewUserAsync();

        var response = await client.GetAsync(new Uri($"/api/sync/pull?{query}", UriKind.Relative));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
