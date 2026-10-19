using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Push;

public sealed record DispatchResult(int Sent, int Removed);

/// <summary>Sends one message to every subscription of a user and keeps the subscriptions honest: gone ones are removed, failing ones counted.</summary>
public static class PushDispatcher
{
    public static async Task<DispatchResult> SendToUserAsync(AppDbContext db, IPushSender sender, Guid userId, PushMessage message, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(sender);

        var subscriptions = await db.PushSubscriptions.Where(s => s.UserId == userId).OrderBy(s => s.CreatedAt).ToListAsync(ct);
        var sent = 0;
        var removed = 0;
        foreach (var subscription in subscriptions)
        {
            var result = await sender.SendAsync(subscription, message, ct);
            switch (result)
            {
                case PushResult.Sent:
                    sent++;
                    subscription.FailureCount = 0;
                    break;
                case PushResult.Gone:
                    db.PushSubscriptions.Remove(subscription);
                    removed++;
                    break;
                default:
                    subscription.FailureCount++;
                    if (subscription.FailureCount >= PushSubscription.MaxFailures)
                    {
                        db.PushSubscriptions.Remove(subscription);
                        removed++;
                    }

                    break;
            }
        }

        await db.SaveChangesAsync(ct);
        return new DispatchResult(sent, removed);
    }
}
