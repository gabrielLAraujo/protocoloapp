using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Push;

public sealed record DispatchResult(int Sent, int Removed);

/// <summary>
/// Sends one message to every subscription of a user and keeps the subscriptions honest: gone ones are removed, failing ones
/// counted (the fifth removes). Bookkeeping is one SQL statement per subscription, never tracked entities, so a subscription
/// deleted meanwhile or a bad one cannot break the rest or the caller's context.
/// </summary>
public static class PushDispatcher
{
    public static async Task<DispatchResult> SendToUserAsync(
        AppDbContext db, IPushSender sender, Guid userId, PushMessage message, ILogger? logger, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(sender);

        var subscriptions = await db.PushSubscriptions.AsNoTracking().Where(s => s.UserId == userId).OrderBy(s => s.CreatedAt).ToListAsync(ct);
        var sent = 0;
        var removed = 0;
        foreach (var subscription in subscriptions)
        {
            PushResult result;
            try
            {
                result = await sender.SendAsync(subscription, message, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger?.LogWarning("Sending to a subscription threw {Error}.", ex.GetType().Name);
                result = PushResult.Failed;
            }

            var id = subscription.Id;
            switch (result)
            {
                case PushResult.Sent:
                    sent++;
                    if (subscription.FailureCount > 0)
                        await db.PushSubscriptions.Where(s => s.Id == id).ExecuteUpdateAsync(u => u.SetProperty(s => s.FailureCount, 0), ct);
                    break;
                case PushResult.Gone:
                    removed += await db.PushSubscriptions.Where(s => s.Id == id).ExecuteDeleteAsync(ct);
                    break;
                default:
                    await db.PushSubscriptions.Where(s => s.Id == id).ExecuteUpdateAsync(u => u.SetProperty(s => s.FailureCount, s => s.FailureCount + 1), ct);
                    removed += await db.PushSubscriptions.Where(s => s.Id == id && s.FailureCount >= PushSubscription.MaxFailures).ExecuteDeleteAsync(ct);
                    break;
            }
        }

        return new DispatchResult(sent, removed);
    }
}
