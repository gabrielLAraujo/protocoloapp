using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;

namespace ProtocoloApp.IntegrationTests.Push;

public sealed class PushEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly Uri PublicKeyUrl = new("/api/push/public-key", UriKind.Relative);

    [Fact]
    public async Task Public_key_is_created_once_and_returned_again()
    {
        using var api = await PlanApi.CreateAsync(factory);

        var first = await api.Client.GetFromJsonAsync<PublicKeyResponse>(PublicKeyUrl);
        var second = await api.Client.GetFromJsonAsync<PublicKeyResponse>(PublicKeyUrl);

        Assert.False(string.IsNullOrWhiteSpace(first!.PublicKey));
        Assert.Equal(first.PublicKey, second!.PublicKey);
    }

    [Fact]
    public async Task Concurrent_first_calls_agree_on_one_key_pair()
    {
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(async _ =>
        {
            await using var scope = factory.Services.CreateAsyncScope();
            return await VapidKeys.GetOrCreateAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), TimeProvider.System, CancellationToken.None);
        }));

        Assert.Single(results.Distinct());
    }

    [Fact]
    public async Task Subscribe_stores_the_subscription_and_is_idempotent_per_endpoint()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var endpoint = PushApi.NewEndpoint();

        Assert.Equal(HttpStatusCode.NoContent, (await PushApi.SubscribeAsync(api.Client, endpoint, PushApi.P256dh1, PushApi.Auth1, "Agent/1")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await PushApi.SubscribeAsync(api.Client, endpoint, PushApi.P256dh2, PushApi.Auth2)).StatusCode);

        var row = Assert.Single(await PushApi.SubscriptionsAsync(factory, endpoint));
        Assert.Equal(api.UserId, row.UserId);
        Assert.Equal(PushApi.P256dh2, row.P256dh);
        Assert.Equal(PushApi.Auth2, row.Auth);
    }

    [Fact]
    public async Task Subscribe_from_another_user_with_the_same_endpoint_reassigns_it()
    {
        using var first = await PlanApi.CreateAsync(factory);
        using var second = await PlanApi.CreateAsync(factory);
        var endpoint = PushApi.NewEndpoint();
        await PushApi.SubscribeAsync(first.Client, endpoint);

        Assert.Equal(HttpStatusCode.NoContent, (await PushApi.SubscribeAsync(second.Client, endpoint)).StatusCode);

        Assert.Equal(second.UserId, Assert.Single(await PushApi.SubscriptionsAsync(factory, endpoint)).UserId);
    }

    [Fact]
    public async Task Subscribe_resets_the_failure_count()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var endpoint = await PushApi.AddSubscriptionAsync(api, failureCount: 3);

        await PushApi.SubscribeAsync(api.Client, endpoint);

        Assert.Equal(0, Assert.Single(await PushApi.SubscriptionsAsync(factory, endpoint)).FailureCount);
    }

    private const string BadPrefix = "BQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
    private const string Short64Bytes = "BAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ";
    private const string Auth15Bytes = "AQEBAQEBAQEBAQEBAQEB";
    private const string Auth17Bytes = "AQEBAQEBAQEBAQEBAQEBAQE";

    [Theory]
    [InlineData("http://fcm.googleapis.com/fcm/send/x", PushApi.P256dh1, PushApi.Auth1)]
    [InlineData("not a url", PushApi.P256dh1, PushApi.Auth1)]
    [InlineData("https://evil.example.test/x", PushApi.P256dh1, PushApi.Auth1)]
    [InlineData("https://notpush.apple.com.evil.test/x", PushApi.P256dh1, PushApi.Auth1)]
    [InlineData("https://xpush.apple.com/x", PushApi.P256dh1, PushApi.Auth1)]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", "", PushApi.Auth1)]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", PushApi.P256dh1, "")]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", "BKey-fictitious", PushApi.Auth1)]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", BadPrefix, PushApi.Auth1)]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", Short64Bytes, PushApi.Auth1)]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", PushApi.P256dh1, Auth15Bytes)]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", PushApi.P256dh1, Auth17Bytes)]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", PushApi.P256dh1, "not base64 !!")]
    public async Task Subscribe_rejects_invalid_input(string endpoint, string p256dh, string auth)
    {
        using var api = await PlanApi.CreateAsync(factory);

        var response = await PushApi.SubscribeAsync(api.Client, endpoint, p256dh, auth);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/")]
    [InlineData("https://web.push.apple.com/")]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/")]
    [InlineData("https://autopush.push.services.mozilla.com/wpush/v2/")]
    [InlineData("https://wns2-par02p.notify.windows.com/w/?token=")]
    public async Task Subscribe_accepts_the_known_push_services(string prefix)
    {
        using var api = await PlanApi.CreateAsync(factory);
        var endpoint = prefix + Guid.NewGuid().ToString("N");

        Assert.Equal(HttpStatusCode.NoContent, (await PushApi.SubscribeAsync(api.Client, endpoint)).StatusCode);
    }

    [Fact]
    public async Task Concurrent_first_subscribes_of_one_endpoint_leave_one_row()
    {
        using var first = await PlanApi.CreateAsync(factory);
        using var second = await PlanApi.CreateAsync(factory);
        var endpoint = PushApi.NewEndpoint();

        var responses = await Task.WhenAll(
            Enumerable.Range(0, 6).Select(i => PushApi.SubscribeAsync(i % 2 == 0 ? first.Client : second.Client, endpoint)));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.NoContent, r.StatusCode));
        Assert.Single(await PushApi.SubscriptionsAsync(factory, endpoint));
    }

    [Fact]
    public async Task Unsubscribe_removes_only_the_callers_subscription()
    {
        using var owner = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        var endpoint = PushApi.NewEndpoint();
        await PushApi.SubscribeAsync(owner.Client, endpoint);

        Assert.Equal(HttpStatusCode.NoContent, (await PushApi.UnsubscribeAsync(other.Client, endpoint)).StatusCode);
        Assert.Single(await PushApi.SubscriptionsAsync(factory, endpoint));

        Assert.Equal(HttpStatusCode.NoContent, (await PushApi.UnsubscribeAsync(owner.Client, endpoint)).StatusCode);
        Assert.Empty(await PushApi.SubscriptionsAsync(factory, endpoint));
    }

    [Fact]
    public async Task Test_push_goes_to_every_subscription_of_the_user()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var a = PushApi.NewEndpoint();
        var b = PushApi.NewEndpoint();
        await PushApi.SubscribeAsync(api.Client, a);
        await PushApi.SubscribeAsync(api.Client, b);

        var response = await api.Client.PostAsync(new Uri("/api/push/test", UriKind.Relative), null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var message = Assert.Single(factory.Push.SentTo(a));
        Assert.Equal("Lembretes ativados ✓", message.Title);
        Assert.Equal("/hoje", message.Url);
        Assert.Single(factory.Push.SentTo(b));
    }

    [Fact]
    public async Task Test_push_removes_a_subscription_the_push_service_dropped()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var endpoint = PushApi.NewEndpoint();
        await PushApi.SubscribeAsync(api.Client, endpoint);
        factory.Push.Results[endpoint] = PushResult.Gone;

        var response = await api.Client.PostAsync(new Uri("/api/push/test", UriKind.Relative), null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(await PushApi.SubscriptionsAsync(factory, endpoint));
    }

    [Fact]
    public async Task A_sender_that_throws_for_one_subscription_does_not_stop_the_others()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var broken = PushApi.NewEndpoint();
        var healthy = PushApi.NewEndpoint();
        await PushApi.SubscribeAsync(api.Client, broken);
        await Task.Delay(20); // the dispatcher goes oldest first: the broken one is tried before the healthy one
        await PushApi.SubscribeAsync(api.Client, healthy);
        factory.Push.Throws[broken] = true;

        var response = await api.Client.PostAsync(new Uri("/api/push/test", UriKind.Relative), null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Single(factory.Push.SentTo(broken));
        Assert.Single(factory.Push.SentTo(healthy));
        Assert.Equal(1, Assert.Single(await PushApi.SubscriptionsAsync(factory, broken)).FailureCount);
        Assert.Equal(0, Assert.Single(await PushApi.SubscriptionsAsync(factory, healthy)).FailureCount);
    }
}
