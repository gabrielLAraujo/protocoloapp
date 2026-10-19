using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Push;

public sealed record PublicKeyResponse(string PublicKey);

public sealed record SubscriptionKeys(string P256dh, string Auth);

public sealed record SubscribeRequest(string Endpoint, SubscriptionKeys Keys, string? UserAgent = null);

public sealed record UnsubscribeRequest(string Endpoint);

public sealed record TestPushResponse(int Sent, int Removed);

/// <summary>
/// Web Push subscriptions of the logged-in user. An endpoint belongs to one user: subscribing with an endpoint another user
/// had moves it. Endpoints, keys and message content are never logged.
/// </summary>
public static class PushEndpoints
{
    public const string TestTitle = "Lembretes ativados ✓";

    public static void MapPush(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        var group = api.MapGroup("/push").WithTags("Push");
        group.MapGet("/public-key", PublicKeyAsync);
        group.MapPost("/subscribe", SubscribeAsync);
        group.MapDelete("/subscribe", UnsubscribeAsync);
        group.MapPost("/test", TestAsync);
    }

    private static async Task<Ok<PublicKeyResponse>> PublicKeyAsync(AppDbContext db, TimeProvider clock, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        var (publicKey, _) = await VapidKeys.GetOrCreateAsync(db, clock, ct);
        return TypedResults.Ok(new PublicKeyResponse(publicKey));
    }

    private static async Task<Results<NoContent, ValidationProblem>> SubscribeAsync(
        SubscribeRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        var errors = Validate(request);
        if (errors.Count > 0)
            return TypedResults.ValidationProblem(errors);

        // An upsert by endpoint in one statement (two first subscribes cannot collide). This is a single-user app: an endpoint
        // that belonged to another user is moved to the caller, as a device that logs in as someone else is theirs now.
        var userId = principal.GetUserId();
        var agent = request!.UserAgent is { Length: > 0 } ua ? ua[..Math.Min(ua.Length, PushSubscription.MaxUserAgentLength)] : null;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, failure_count, created_at)
            VALUES ({Guid.NewGuid()}, {userId}, {request.Endpoint}, {request.Keys.P256dh}, {request.Keys.Auth}, {agent}, 0, {clock.GetUtcNow()})
            ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
                user_agent = EXCLUDED.user_agent, failure_count = 0
            """,
            ct);
        return TypedResults.NoContent();
    }

    private static async Task<NoContent> UnsubscribeAsync(
        [FromBody] UnsubscribeRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);

        if (request?.Endpoint is { Length: > 0 } endpoint)
        {
            var userId = principal.GetUserId();
            await db.PushSubscriptions.Where(s => s.UserId == userId && s.Endpoint == endpoint).ExecuteDeleteAsync(ct);
        }

        return TypedResults.NoContent();
    }

    private static async Task<Ok<TestPushResponse>> TestAsync(ClaimsPrincipal principal, AppDbContext db, IPushSender sender, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(sender);

        var message = new PushMessage(TestTitle, "Você vai receber os avisos do protocolo neste aparelho.", ReminderCopy.TodayUrl, "test");
        var result = await PushDispatcher.SendToUserAsync(db, sender, principal.GetUserId(), message, null, ct);
        return TypedResults.Ok(new TestPushResponse(result.Sent, result.Removed));
    }

    private static Dictionary<string, string[]> Validate(SubscribeRequest? request)
    {
        var errors = new Dictionary<string, string[]>();
        if (request is null)
        {
            errors["endpoint"] = ["Informe a inscrição."];
            return errors;
        }

        if (!IsAllowedEndpoint(request.Endpoint))
            errors["endpoint"] = ["O endereço da inscrição deve ser https de um serviço de push conhecido."];

        // p256dh: an uncompressed P-256 point (0x04 + 64 bytes); auth: 16 bytes. Both unpadded base64url.
        if (WebPushCrypto.TryDecode(request.Keys?.P256dh) is not { Length: WebPushCrypto.PublicKeyLength } p256dh || p256dh[0] != 0x04)
            errors["keys.p256dh"] = ["Chave p256dh inválida."];

        if (WebPushCrypto.TryDecode(request.Keys?.Auth) is not { Length: WebPushCrypto.AuthSecretLength })
            errors["keys.auth"] = ["Chave auth inválida."];

        return errors;
        }

        if (string.IsNullOrEmpty(request.Endpoint)
            || request.Endpoint.Length > PushSubscription.MaxEndpointLength
            || !Uri.TryCreate(request.Endpoint, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps)
            errors["endpoint"] = ["O endereço da inscrição deve ser uma URL https."];

        if (request.Keys is null || string.IsNullOrEmpty(request.Keys.P256dh) || request.Keys.P256dh.Length > PushSubscription.MaxKeyLength)
            errors["keys.p256dh"] = ["Chave p256dh inválida."];

        if (request.Keys is null || string.IsNullOrEmpty(request.Keys.Auth) || request.Keys.Auth.Length > PushSubscription.MaxKeyLength)
            errors["keys.auth"] = ["Chave auth inválida."];

        return errors;
    }

    private static readonly string[] ExactHosts = ["fcm.googleapis.com", "updates.push.services.mozilla.com"];

    private static readonly string[] HostSuffixes = [".push.apple.com", ".push.services.mozilla.com", ".notify.windows.com"];

    /// <summary>https to the push services of the browsers we serve (Chrome/FCM, Safari/Apple, Firefox, Edge/WNS): the server will POST to this URL.</summary>
    public static bool IsAllowedEndpoint(string? endpoint)
    {
        if (string.IsNullOrEmpty(endpoint) || endpoint.Length > PushSubscription.MaxEndpointLength
            || !Uri.TryCreate(endpoint, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps || uri.UserInfo.Length > 0)
            return false;

        var host = uri.IdnHost.ToLowerInvariant();
        return ExactHosts.Contains(host, StringComparer.Ordinal) || HostSuffixes.Any(suffix => host.EndsWith(suffix, StringComparison.Ordinal));
    }
}
