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

    private static async Task<Ok<PublicKeyResponse>> PublicKeyAsync(AppDbContext db, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);

        var (publicKey, _) = await VapidKeys.GetOrCreateAsync(db, ct);
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

        var userId = principal.GetUserId();
        var subscription = await db.PushSubscriptions.SingleOrDefaultAsync(s => s.Endpoint == request!.Endpoint, ct);
        if (subscription is null)
        {
            subscription = new PushSubscription { Id = Guid.NewGuid(), Endpoint = request!.Endpoint, CreatedAt = clock.GetUtcNow() };
            db.PushSubscriptions.Add(subscription);
        }

        subscription.UserId = userId;
        subscription.P256dh = request!.Keys.P256dh;
        subscription.Auth = request.Keys.Auth;
        subscription.UserAgent = request.UserAgent is { Length: > 0 } agent ? agent[..Math.Min(agent.Length, PushSubscription.MaxUserAgentLength)] : null;
        subscription.FailureCount = 0;
        await db.SaveChangesAsync(ct);
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
        var result = await PushDispatcher.SendToUserAsync(db, sender, principal.GetUserId(), message, ct);
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
}
