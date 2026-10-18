using System.Text.Json;
using FluentValidation;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Sync;

/// <summary>
/// The sync rules shared by every entity; a subclass only maps its payload. For one change:
/// <list type="number">
/// <item>An id owned by another user is rejected (<c>forbidden</c>).</item>
/// <item>A change not newer than the stored one (<c>ClientUpdatedAt &lt;=</c>) is <c>stale</c>: this makes replays harmless.</item>
/// <item>Delete soft-deletes (a delete of an unknown id has nothing to do and is <c>applied</c>). Upsert validates the
/// payload, creates or overwrites the row and clears <c>DeletedAt</c> (a newer upsert wins over a delete).</item>
/// <item>Every applied write gets a new <see cref="SyncVersion"/> and the server timestamps.</item>
/// </list>
/// </summary>
public abstract class SyncHandler<TEntity, TPayload>(AppDbContext db, TimeProvider clock) : ISyncHandler
    where TEntity : class, ISyncEntity
    where TPayload : class
{
    public abstract string Entity { get; }

    protected AppDbContext Db => db;

    protected abstract IValidator<TPayload> Validator { get; }

    /// <summary>A new, empty row owned by <paramref name="userId"/>.</summary>
    protected abstract TEntity Create(Guid id, Guid userId);

    /// <summary>Copies a validated payload onto the row.</summary>
    protected abstract void Apply(TPayload payload, TEntity entity);

    protected abstract TPayload CreatePayload(TEntity entity);

    /// <summary>
    /// Business uniqueness the payload can break (checked after <see cref="Apply"/>, before saving). Returns an error code
    /// or null. Race-free: all sync writes of the user run under the user's lock.
    /// </summary>
    protected virtual Task<string?> FindConflictAsync(TEntity entity, CancellationToken cancellationToken) =>
        Task.FromResult<string?>(null);

    public IQueryable<ISyncEntity> Query(Guid userId) => db.Set<TEntity>().Where(e => e.UserId == userId);

    public JsonElement ToPayload(ISyncEntity entity) => SyncPayload.Write(CreatePayload((TEntity)entity));

    public async Task<SyncChangeResult> ApplyAsync(SyncChange change, Guid userId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(change);

        var existing = await db.Set<TEntity>().FindAsync(new object?[] { change.Id }, ct);
        if (existing is not null && existing.UserId != userId)
            return SyncChangeResult.Rejected(change.Id, SyncErrors.Forbidden);
        if (existing is not null && change.ClientUpdatedAt <= existing.ClientUpdatedAt)
            return SyncChangeResult.Stale(change.Id);

        var now = clock.GetUtcNow();
        TEntity target;
        if (change.Op == SyncOp.Delete)
        {
            if (existing is null)
                return SyncChangeResult.Applied(change.Id);

            target = existing;
            target.DeletedAt ??= now;
        }
        else
        {
            var payload = SyncPayload.Read(change.Payload, Validator, out var errors);
            if (payload is null)
                return SyncChangeResult.Rejected(change.Id, errors);

            target = existing ?? Create(change.Id, userId);
            Apply(payload, target);
            target.DeletedAt = null;

            var conflict = await FindConflictAsync(target, ct);
            if (conflict is not null)
                return SyncChangeResult.Rejected(change.Id, conflict);

            if (existing is null)
            {
                target.CreatedAt = now;
                db.Add(target);
            }
        }

        target.ClientUpdatedAt = change.ClientUpdatedAt;
        target.UpdatedAt = now;
        target.Version = await SyncVersion.NextAsync(db, ct);
        await db.SaveChangesAsync(ct);
        return SyncChangeResult.Applied(change.Id);
    }
}
