using System.Text.Json.Serialization;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>Code of the last error of the Hevy connection, as the status shows it.</summary>
public enum HevyErrorCode
{
    [JsonStringEnumMemberName("unauthorized")]
    Unauthorized,

    [JsonStringEnumMemberName("rate_limited")]
    RateLimited,

    [JsonStringEnumMemberName("unavailable")]
    Unavailable,

    [JsonStringEnumMemberName("format")]
    Format,

    /// <summary>The stored key no longer opens (the server's encryption key changed).</summary>
    [JsonStringEnumMemberName("key_unreadable")]
    KeyUnreadable,
}

/// <summary>The counts of one sync run.</summary>
public sealed record HevySyncResult(
    int Imported,
    int Updated,
    int Deleted,
    int Unchanged,
    int SkippedNoPlan,
    int SkippedSets,
    int PendingExercises);

/// <summary>
/// The state of the user's Hevy connection. The key itself never leaves the server: only its last 4 characters.
/// When not connected, <see cref="SyncFrom"/> is the default start date the form proposes.
/// </summary>
public sealed record HevyStatusResponse(
    bool ServerConfigured,
    bool Connected,
    string? KeyLast4,
    DateOnly? SyncFrom,
    DateTimeOffset? LastAttemptAt,
    DateTimeOffset? LastSuccessAt,
    HevyErrorCode? LastError,
    HevySyncResult? LastResult,
    bool Running,
    int PendingExercises);

/// <summary>Connects (or replaces) the key. <see cref="SyncFrom"/> defaults to the start of the open update cycle, else today − 30.</summary>
public sealed record ConnectHevyRequest(string? ApiKey, DateOnly? SyncFrom = null);

/// <summary>Changes the start date of the import; the cursor is reset, so the next run reimports from it.</summary>
public sealed record UpdateHevyRequest(DateOnly? SyncFrom);
