using System.Data;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Sync;

/// <summary>
/// <c>GET /api/sync/pull?since=&amp;limit=</c>: the user's rows of every entity with <c>version &gt; since</c>, in version
/// order, at most <c>limit</c> (default and maximum 500) per page.
/// </summary>
public static class PullEndpoint
{
    public const int MaxLimit = 500;

    public static async Task<Results<Ok<SyncPullResponse>, ValidationProblem>> HandleAsync(
        long? since,
        int? limit,
        ClaimsPrincipal principal,
        AppDbContext db,
        SyncHandlerRegistry handlers,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(handlers);

        var from = since ?? 0;
        var take = limit ?? MaxLimit;
        var errors = new Dictionary<string, string[]>();
        if (from < 0)
            errors["since"] = ["Deve ser maior ou igual a 0."];
        if (take is < 1 or > MaxLimit)
            errors["limit"] = [$"Deve estar entre 1 e {MaxLimit}."];
        if (errors.Count > 0)
            return TypedResults.ValidationProblem(errors);

        var userId = principal.GetUserId();

        // One snapshot for all the entities: with one query per entity under READ COMMITTED, a push committed between two
        // queries could show its higher version and hide its lower one, and the client would skip the lower one forever.
        await using var transaction = await db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);

        // The first take + 1 rows of the union are among the first take + 1 rows of each entity.
        var rows = new List<(ISyncHandler Handler, ISyncEntity Entity)>();
        foreach (var handler in handlers.All)
        {
            var page = await handler.Query(userId).ChangedSince(from, take + 1).ToListAsync(ct);
            rows.AddRange(page.Select(entity => (handler, entity)));
        }

        await transaction.CommitAsync(ct);

        var ordered = rows.OrderBy(r => r.Entity.Version).Take(take + 1).ToList();
        var hasMore = ordered.Count > take;
        var records = ordered.Take(take)
            .Select(r => new SyncRecord(
                r.Handler.Entity,
                r.Entity.Id,
                r.Entity.Version,
                r.Entity.DeletedAt is null ? r.Handler.ToPayload(r.Entity) : null,
                r.Entity.DeletedAt,
                r.Entity.ClientUpdatedAt))
            .ToList();

        return TypedResults.Ok(new SyncPullResponse(records, records.Count > 0 ? records[^1].Version : from, hasMore));
    }
}

internal static class SyncQueryable
{
    private static readonly MethodInfo ChangedSinceMethod =
        typeof(SyncQueryable).GetMethod(nameof(ChangedSinceTyped), BindingFlags.NonPublic | BindingFlags.Static)!;

    /// <summary>
    /// <c>Where(version &gt; since).OrderBy(version).Take(take)</c>, untracked, on a handler's query. The predicate is built
    /// on the concrete entity type (<see cref="IQueryable.ElementType"/>), so EF Core never has to translate a member
    /// accessed through the <see cref="ISyncEntity"/> interface.
    /// </summary>
    public static IQueryable<ISyncEntity> ChangedSince(this IQueryable<ISyncEntity> source, long since, int take) =>
        (IQueryable<ISyncEntity>)ChangedSinceMethod.MakeGenericMethod(source.ElementType).Invoke(null, [source, since, take])!;

    private static IQueryable<ISyncEntity> ChangedSinceTyped<TEntity>(IQueryable<ISyncEntity> source, long since, int take)
        where TEntity : class, ISyncEntity =>
        ((IQueryable<TEntity>)source).AsNoTracking().Where(e => e.Version > since).OrderBy(e => e.Version).Take(take);
}
