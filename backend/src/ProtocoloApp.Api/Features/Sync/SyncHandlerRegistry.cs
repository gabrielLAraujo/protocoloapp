namespace ProtocoloApp.Api.Features.Sync;

/// <summary>The registered <see cref="ISyncHandler"/>s by entity name (exact, case-sensitive).</summary>
public sealed class SyncHandlerRegistry
{
    private readonly Dictionary<string, ISyncHandler> _byEntity = new(StringComparer.Ordinal);

    public SyncHandlerRegistry(IEnumerable<ISyncHandler> handlers)
    {
        ArgumentNullException.ThrowIfNull(handlers);

        foreach (var handler in handlers)
        {
            if (!_byEntity.TryAdd(handler.Entity, handler))
                throw new InvalidOperationException($"Two sync handlers for the entity '{handler.Entity}'.");
        }
    }

    public IReadOnlyCollection<ISyncHandler> All => _byEntity.Values;

    public ISyncHandler? Find(string entity) => _byEntity.GetValueOrDefault(entity);
}
