using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;

namespace ProtocoloApp.IntegrationTests.Push;

[Collection("api")]
public sealed class PushEndpointTests(ApiFactory factory)
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
            return await VapidKeys.GetOrCreateAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), CancellationToken.None);
        }));

        Assert.Single(results.Distinct());
    }

    [Fact]
    public async Task Subscribe_stores_the_subscription_and_is_idempotent_per_endpoint()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var endpoint = PushApi.NewEndpoint();

        Assert.Equal(HttpStatusCode.NoContent, (await PushApi.SubscribeAsync(api.Client, endpoint, "key-1", "auth-1", "Agent/1")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await PushApi.SubscribeAsync(api.Client, endpoint, "key-2", "auth-2")).StatusCode);

        var row = Assert.Single(await PushApi.SubscriptionsAsync(factory, endpoint));
        Assert.Equal(api.UserId, row.UserId);
        Assert.Equal("key-2", row.P256dh);
        Assert.Equal("auth-2", row.Auth);
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

    [Theory]
    [InlineData("http://push.example.test/insecure", "k", "a")]
    [InlineData("not a url", "k", "a")]
    [InlineData("https://push.example.test/x", "", "a")]
    [InlineData("https://push.example.test/x", "k", "")]
    public async Task Subscribe_rejects_invalid_input(string endpoint, string p256dh, string auth)
    {
        using var api = await PlanApi.CreateAsync(factory);

        var response = await PushApi.SubscribeAsync(api.Client, endpoint, p256dh, auth);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
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
}
