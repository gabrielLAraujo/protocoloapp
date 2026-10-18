using System.Text.Json;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Sync;

/// <summary>
/// Plugs one entity into the sync engine. Register it with <see cref="SyncSetup.AddSyncHandler{THandler}"/>; derive from
/// <see cref="SyncHandler{TEntity,TPayload}"/> instead of implementing this by hand.
/// </summary>
public interface ISyncHandler
{
    /// <summary>The entity name on the wire, e.g. <c>daily_checkin</c>.</summary>
    string Entity { get; }

    /// <summary>
    /// Applies one change for <paramref name="userId"/>. Runs inside the push transaction, under the user's sync lock and a
    /// savepoint: returning <see cref="SyncResultStatus.Rejected"/> rolls back whatever the handler wrote.
    /// </summary>
    Task<SyncChangeResult> ApplyAsync(SyncChange change, Guid userId, CancellationToken ct);

    /// <summary>All rows of the user, deleted ones included. The element type must be the concrete entity.</summary>
    IQueryable<ISyncEntity> Query(Guid userId);

    /// <summary>The snake_case JSON payload of a row (the same shape the client pushes).</summary>
    JsonElement ToPayload(ISyncEntity entity);
}
