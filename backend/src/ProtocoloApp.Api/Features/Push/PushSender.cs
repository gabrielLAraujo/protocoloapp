using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Shared.Data;

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

public interface IVapidProvider
{
    Task<VapidDetails> GetAsync(CancellationToken ct);
}

/// <summary>The VAPID details, read once from the database (keys are generated the first time).</summary>
public sealed class VapidProvider(IServiceScopeFactory scopes, IOptions<PushOptions> options, TimeProvider clock) : IVapidProvider
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
                var (publicKey, privateKey) = await VapidKeys.GetOrCreateAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), clock, ct);
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

/// <summary>
/// Sends Web Push requests: payload encrypted as <c>aes128gcm</c> (RFC 8291), identified with VAPID (RFC 8292). Any failure
/// that is not a cancellation is a <see cref="PushResult.Failed"/>; payloads and endpoints are never logged.
/// </summary>
public sealed class WebPushSender(HttpClient http, IVapidProvider vapid, TimeProvider clock, ILogger<WebPushSender> logger) : IPushSender
{
    /// <summary>Seconds the push service may hold a message for an offline device: a reminder is useless later.</summary>
    public const int TtlSeconds = 3600;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<PushResult> SendAsync(PushSubscription subscription, PushMessage message, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(subscription);
        ArgumentNullException.ThrowIfNull(message);

        try
        {
            var userKey = WebPushCrypto.TryDecode(subscription.P256dh) ?? throw new FormatException("p256dh");
            var authSecret = WebPushCrypto.TryDecode(subscription.Auth) ?? throw new FormatException("auth");
            var payload = JsonSerializer.SerializeToUtf8Bytes(new { title = message.Title, body = message.Body, url = message.Url, tag = message.Tag }, Json);
            var details = await vapid.GetAsync(ct);

            using var request = new HttpRequestMessage(HttpMethod.Post, subscription.Endpoint);
            request.Content = new ByteArrayContent(WebPushCrypto.Encrypt(payload, userKey, authSecret));
            request.Content.Headers.ContentEncoding.Add("aes128gcm");
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            request.Headers.TryAddWithoutValidation("TTL", TtlSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture));
            request.Headers.TryAddWithoutValidation("Authorization", Vapid.AuthorizationHeader(request.RequestUri!, details, clock.GetUtcNow()));

            using var response = await http.SendAsync(request, ct);
            if (response.IsSuccessStatusCode)
                return PushResult.Sent;
            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
                return PushResult.Gone;

            logger.LogWarning("Push to a subscription failed: status {Status}.", (int)response.StatusCode);
            return PushResult.Failed;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Bad stored keys, a network error, a timeout...: the subscription failed, the others go on. Type only.
            logger.LogWarning("Push to a subscription failed: {Error}.", ex.GetType().Name);
            return PushResult.Failed;
        }
    }
}
