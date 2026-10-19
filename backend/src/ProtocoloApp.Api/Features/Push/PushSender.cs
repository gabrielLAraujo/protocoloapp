using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Shared.Data;
using WebPush;

namespace ProtocoloApp.Api.Features.Push;

/// <summary>What a notification shows. <c>Tag</c> replaces an earlier notification of the same slot; <c>Url</c> opens on tap.</summary>
public sealed record PushMessage(string Title, string Body, string Url, string Tag);

public enum PushResult
{
    Sent,

    /// <summary>The push service says the subscription no longer exists (404/410): remove it.</summary>
    Gone,

    Failed,
}

public interface IPushSender
{
    Task<PushResult> SendAsync(PushSubscription subscription, PushMessage message, CancellationToken ct);
}

public sealed class PushOptions
{
    public const string Section = "Push";

    /// <summary>VAPID subject (<c>mailto:</c> or https URL) the push services may contact.</summary>
    public string Subject { get; set; } = "mailto:admin@frauchesgabriel.work";
}

/// <summary>The VAPID details, read once from the database (keys are generated the first time).</summary>
public sealed class VapidProvider(IServiceScopeFactory scopes, IOptions<PushOptions> options)
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private VapidDetails? _details;

    public async Task<VapidDetails> GetAsync(CancellationToken ct)
    {
        if (_details is not null)
            return _details;

        await _gate.WaitAsync(ct);
        try
        {
            if (_details is null)
            {
                await using var scope = scopes.CreateAsyncScope();
                var (publicKey, privateKey) = await VapidKeys.GetOrCreateAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), ct);
                _details = new VapidDetails(options.Value.Subject, publicKey, privateKey);
            }

            return _details;
        }
        finally
        {
            _gate.Release();
        }
    }
}

/// <summary>Sends with the <c>WebPush</c> package (VAPID + aes128gcm). Payloads are never logged.</summary>
public sealed class WebPushSender(HttpClient http, VapidProvider vapid, ILogger<WebPushSender> logger) : IPushSender
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly WebPushClient _client = new(http);

    public async Task<PushResult> SendAsync(PushSubscription subscription, PushMessage message, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(subscription);
        ArgumentNullException.ThrowIfNull(message);

        var target = new WebPush.PushSubscription(subscription.Endpoint, subscription.P256dh, subscription.Auth);
        var payload = JsonSerializer.Serialize(new { title = message.Title, body = message.Body, url = message.Url, tag = message.Tag }, Json);
        try
        {
            var details = await vapid.GetAsync(ct);
            await _client.SendNotificationAsync(target, payload, details, ct);
            return PushResult.Sent;
        }
        catch (WebPushException ex) when (ex.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
        {
            return PushResult.Gone;
        }
        catch (WebPushException ex)
        {
            logger.LogWarning("Push to a subscription failed: status {Status}.", (int)ex.StatusCode);
            return PushResult.Failed;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            logger.LogWarning("Push to a subscription failed: {Error}.", ex.GetType().Name);
            return PushResult.Failed;
        }
    }
}
