namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>Hevy sync log events. Counts, error codes and exception type names only: never the key nor workout content.</summary>
internal static partial class HevyLog
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Hevy sync skipped: another run holds the lock.")]
    public static partial void RunLocked(this ILogger logger);

    [LoggerMessage(Level = LogLevel.Information,
        Message = "Hevy sync finished: {Pages} pages, {Imported} imported, {Updated} updated, {Deleted} deleted, {Unchanged} unchanged, {SkippedNoPlan} without plan, {SkippedSets} sets skipped, {SkippedItems} unreadable items, {Pending} pending exercises, capped {Capped}.")]
    public static partial void RunFinished(
        this ILogger logger, int pages, int imported, int updated, int deleted, int unchanged, int skippedNoPlan, int skippedSets, int skippedItems, int pending, bool capped);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Hevy sync failed: {Error} after {Pages} pages.")]
    public static partial void RunFailed(this ILogger logger, string error, int pages);

    [LoggerMessage(Level = LogLevel.Error, Message = "Hevy sync crashed: {Error}.")]
    public static partial void RunCrashed(this ILogger logger, string error);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Hevy templates lookup stopped: {Error}.")]
    public static partial void TemplatesFailed(this ILogger logger, string error);

    [LoggerMessage(Level = LogLevel.Error, Message = "Hevy sync of a user failed: {Error}.")]
    public static partial void UserFailed(this ILogger logger, string error);

    [LoggerMessage(Level = LogLevel.Error, Message = "Hevy scheduler tick failed: {Error}.")]
    public static partial void TickFailed(this ILogger logger, string error);

    [LoggerMessage(Level = LogLevel.Information, Message = "Hevy scheduler tick: {Users} users, {Succeeded} synced.")]
    public static partial void TickFinished(this ILogger logger, int users, int succeeded);
}
