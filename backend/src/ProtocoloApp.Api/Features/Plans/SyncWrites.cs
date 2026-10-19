using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>
/// How server code (not a sync handler) writes a sync entity such as <see cref="PlanVersion"/> or <see cref="Exercise"/>:
/// the write must be stamped with a new <see cref="SyncVersion"/> inside a transaction that holds the user's sync lock, or a
/// client could pull past a version that commits later and miss it. Usage:
/// <code>
/// await using var tx = await SyncWrites.BeginAsync(db, userId, ct);   // transaction + user lock
/// plan.Status = PlanStatus.Archived;
/// await SyncWrites.StampAsync(db, plan, userId, clock, ct);           // version + timestamps, once per changed row
/// await db.SaveChangesAsync(ct);
/// await tx.CommitAsync(ct);
/// </code>
/// New rows still need <c>db.Add</c>. Stamp every row you change, including the ones you archive or soft-delete.
/// </summary>
public static class SyncWrites
{
    /// <summary>Starts a transaction and takes the user's sync lock (released at commit or rollback).</summary>
    public static async Task<IDbContextTransaction> BeginAsync(AppDbContext db, Guid userId, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(db);

        var transaction = await db.Database.BeginTransactionAsync(ct);
        try
        {
            await SyncVersion.LockUserAsync(db, userId, ct);
            return transaction;
        }
        catch
        {
            await transaction.DisposeAsync();
            throw;
        }
    }

    /// <summary>
    /// Gives the row a new global version and the server timestamps; <c>ClientUpdatedAt</c> follows <c>UpdatedAt</c> (the server
    /// is the author), truncated to microseconds like the database. Takes the user's lock again (a no-op when
    /// <see cref="BeginAsync"/> already holds it).
    /// </summary>
    /// <exception cref="InvalidOperationException">No current transaction, or the row belongs to another user.</exception>
    public static async Task StampAsync(AppDbContext db, ISyncEntity entity, Guid userId, TimeProvider clock, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(entity);
        ArgumentNullException.ThrowIfNull(clock);

        if (entity.UserId != userId)
            throw new InvalidOperationException("The row belongs to another user.");

        await SyncVersion.LockUserAsync(db, userId, ct);

        var now = clock.GetUtcNow();
        now = new DateTimeOffset(now.UtcTicks / 10 * 10, TimeSpan.Zero);
        if (entity.CreatedAt == default)
            entity.CreatedAt = now;
        entity.UpdatedAt = now;
        entity.ClientUpdatedAt = now;
        entity.Version = await SyncVersion.NextAsync(db, ct);
    }
}
