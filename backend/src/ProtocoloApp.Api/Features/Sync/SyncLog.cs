namespace ProtocoloApp.Api.Features.Sync;

/// <summary>Sync log events. Only entity, id, status and error codes: never the payload.</summary>
internal static partial class SyncLog
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Sync change {Entity} {Id}: {Status} {Errors}")]
    public static partial void ChangeProcessed(this ILogger logger, string entity, Guid id, SyncResultStatus status, string errors);

    [LoggerMessage(Level = LogLevel.Information, Message = "Sync push of {Count} changes: {Applied} applied, {Stale} stale, {Rejected} rejected")]
    public static partial void PushProcessed(this ILogger logger, int count, int applied, int stale, int rejected);
}
