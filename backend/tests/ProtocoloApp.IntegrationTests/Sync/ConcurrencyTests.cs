using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Auth;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Sync;

[Collection("api")]
public sealed class ConcurrencyTests(ApiFactory factory)
{
    private const int Pushes = 20;

    /// <summary>
    /// A pull that advances <c>since</c> past a version whose transaction has not committed yet would skip that record
    /// forever. The puller below behaves like the client: it only ever moves forward from <c>NextSince</c>, never back to 0.
    /// Whatever the interleaving, every pushed record must reach it.
    /// </summary>
    [Fact]
    public async Task Concurrent_pushes_never_lose_records_on_pull()
    {
        using var client = await factory.CreateAuthenticatedClientAsync(AuthApi.NewEmail());
        using var otherUser = await factory.CreateAuthenticatedClientAsync(AuthApi.NewEmail());
        var ids = Enumerable.Range(0, Pushes).Select(_ => Guid.NewGuid()).ToArray();
        var day = new DateOnly(2026, 5, 1);
        var at = SyncApi.Past();

        var seen = new HashSet<Guid>();
        long since = 0;
        var pushes = Task.WhenAll(ids.Select((id, i) => SyncApi.PushAsync(client, SyncApi.Checkin(id, day.AddDays(i), at))));

        while (!pushes.IsCompleted)
        {
            var page = await SyncApi.PullAsync(client, since);
            seen.UnionWith(page.Records.Select(r => r.Id));
            since = page.NextSince;
        }

        var results = await pushes;
        Assert.All(results, r => Assert.Equal(SyncResultStatus.Applied, Assert.Single(r).Status));

        // Drain from where the puller stopped.
        SyncPullResponse last;
        do
        {
            last = await SyncApi.PullAsync(client, since);
            seen.UnionWith(last.Records.Select(r => r.Id));
            since = last.NextSince;
        }
        while (last.HasMore);

        Assert.Equal(ids.Order(), seen.Order());
        Assert.Empty((await SyncApi.PullAsync(otherUser, 0)).Records);
    }
}
