using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;

namespace ProtocoloApp.IntegrationTests.Push;

internal static class PushApi
{
    public static string NewEndpoint() => $"https://push.example.test/send/{Guid.NewGuid():N}";

    public static Task<HttpResponseMessage> SubscribeAsync(HttpClient client, string endpoint, string p256dh = "BKey-fictitious", string auth = "auth-fictitious", string? userAgent = null) =>
        client.PostAsJsonAsync(new Uri("/api/push/subscribe", UriKind.Relative), new SubscribeRequest(endpoint, new SubscriptionKeys(p256dh, auth), userAgent));

    public static Task<HttpResponseMessage> UnsubscribeAsync(HttpClient client, string endpoint)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, new Uri("/api/push/subscribe", UriKind.Relative))
        {
            Content = JsonContent.Create(new UnsubscribeRequest(endpoint)),
        };
        return client.SendAsync(request);
    }

    public static async Task<List<ProtocoloApp.Api.Features.Push.PushSubscription>> SubscriptionsAsync(ApiFactory factory, string endpoint)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.PushSubscriptions.AsNoTracking().Where(s => s.Endpoint == endpoint).ToListAsync();
    }

    /// <summary>A subscription row for the user, straight in the database.</summary>
    public static async Task<string> AddSubscriptionAsync(PlanApi api, int failureCount = 0)
    {
        var endpoint = NewEndpoint();
        await api.WithDbAsync(async db =>
        {
            db.PushSubscriptions.Add(new ProtocoloApp.Api.Features.Push.PushSubscription
            {
                Id = Guid.NewGuid(),
                UserId = api.UserId,
                Endpoint = endpoint,
                P256dh = "BKey-fictitious",
                Auth = "auth-fictitious",
                FailureCount = failureCount,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
            return 0;
        });
        return endpoint;
    }
}
