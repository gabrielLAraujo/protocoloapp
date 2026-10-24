using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Features.Integrations.Secrets;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>
/// Syncs every connected user with Hevy each <see cref="HevyOptions.IntervalMinutes"/>, the first time
/// <see cref="FirstDelay"/> after start. Idle when <c>Hevy:Enabled</c> is false or the server has no encryption key. A user
/// whose run is going on ("Sincronizar agora") is skipped by the lock. Nothing here takes the host down.
/// </summary>
public sealed class HevySyncScheduler(
    IServiceScopeFactory scopes,
    TimeProvider clock,
    ISecretProtector protector,
    IOptions<HevyOptions> options,
    ILogger<HevySyncScheduler> logger) : BackgroundService
{
    public static readonly TimeSpan FirstDelay = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled || !protector.IsConfigured)
            return;

        var interval = TimeSpan.FromMinutes(Math.Max(1, options.Value.IntervalMinutes));
        try
        {
            await Task.Delay(FirstDelay, clock, stoppingToken);
            using var timer = new PeriodicTimer(interval, clock);
            do
            {
                try
                {
                    await RunOnceAsync(stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.TickFailed(ex.GetType().Name);
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    /// <summary>One pass over every connection, a scope per user; returns how many runs finished without error.</summary>
    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        if (!protector.IsConfigured)
            return 0;

        List<Guid> userIds;
        await using (var listScope = scopes.CreateAsyncScope())
        {
            userIds = await listScope.ServiceProvider.GetRequiredService<AppDbContext>()
                .HevyConnections.AsNoTracking().OrderBy(c => c.UserId).Select(c => c.UserId).ToListAsync(ct);
        }

        var succeeded = 0;
        foreach (var userId in userIds)
        {
            try
            {
                // A scope (and DbContext) per user: whatever goes wrong for one user leaves nothing behind for the next.
                await using var scope = scopes.CreateAsyncScope();
                var run = await scope.ServiceProvider.GetRequiredService<HevySyncRunner>().RunAsync(userId, ct);
                if (run.Result is not null)
                    succeeded++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Only the type: messages of database errors may carry values.
                logger.UserFailed(ex.GetType().Name);
            }
        }

        logger.TickFinished(userIds.Count, succeeded);
        return succeeded;
    }
}
