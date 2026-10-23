using System.Text.Json;

namespace ProtocoloApp.Api.Features.Sync;

public enum SyncOp
{
    Upsert,
    Delete,
}

public enum SyncResultStatus
{
    /// <summary>The change was stored (or there was nothing to delete). The client can drop it from its outbox.</summary>
    Applied,

    /// <summary>The server already has this change or a newer one (last-write-wins). The client can drop it too.</summary>
    Stale,

    /// <summary>The change can never be applied as sent; <see cref="SyncChangeResult.Errors"/> says why. Retrying is useless.</summary>
    Rejected,
}

/// <summary>One local change. <paramref name="Payload"/> is the entity's snake_case JSON (required for upsert, ignored for delete).</summary>
public sealed record SyncChange(string Entity, Guid Id, SyncOp Op, JsonElement? Payload, DateTimeOffset ClientUpdatedAt);

/// <summary>Up to 500 changes, applied in order. Each one succeeds or fails on its own.</summary>
public sealed record SyncPushRequest(IReadOnlyList<SyncChange> Changes);

/// <summary>The outcome of one change. <paramref name="Errors"/> holds stable codes (<see cref="SyncErrors"/>) when rejected.</summary>
public sealed record SyncChangeResult(Guid Id, SyncResultStatus Status, IReadOnlyList<string>? Errors)
{
    public static SyncChangeResult Applied(Guid id) => new(id, SyncResultStatus.Applied, null);

    public static SyncChangeResult Stale(Guid id) => new(id, SyncResultStatus.Stale, null);

    public static SyncChangeResult Rejected(Guid id, IReadOnlyList<string> errors) => new(id, SyncResultStatus.Rejected, errors);

    public static SyncChangeResult Rejected(Guid id, string error) => new(id, SyncResultStatus.Rejected, [error]);
}

/// <summary>One result per change, in the order of the request.</summary>
public sealed record SyncPushResponse(IReadOnlyList<SyncChangeResult> Results);

/// <summary>
/// The current server state of one row. <paramref name="Payload"/> is null when the row is deleted
/// (<paramref name="DeletedAt"/> set). <paramref name="ClientUpdatedAt"/> is the last-write-wins key, for the client to
/// compare with a local pending change.
/// </summary>
public sealed record SyncRecord(string Entity, Guid Id, long Version, JsonElement? Payload, DateTimeOffset? DeletedAt, DateTimeOffset ClientUpdatedAt);

/// <summary>Records ordered by version. Ask again with <c>since = NextSince</c> while <paramref name="HasMore"/> is true.</summary>
public sealed record SyncPullResponse(IReadOnlyList<SyncRecord> Records, long NextSince, bool HasMore);

/// <summary>Rejection codes. They are stable: the front maps them to pt-BR messages.</summary>
public static class SyncErrors
{
    /// <summary>No handler for <see cref="SyncChange.Entity"/>.</summary>
    public const string UnknownEntity = "unknown_entity";

    /// <summary><see cref="SyncChange.ClientUpdatedAt"/> is later than server now + 5 min (device clock ahead).</summary>
    public const string ClientUpdatedAtInFuture = "client_updated_at_in_future";

    /// <summary>The id belongs to another user.</summary>
    public const string Forbidden = "forbidden";

    /// <summary>daily_checkin: another live check-in of the user already has this date.</summary>
    public const string DateConflict = "date_conflict";

    /// <summary>schedule_slot / adherence_log: another live row of the user already has the same natural key.</summary>
    public const string SlotConflict = "slot_conflict";

    /// <summary>Missing payload, not a JSON object, or a field that is invalid (<c>invalid_payload:&lt;field&gt;</c>).</summary>
    public const string InvalidPayload = "invalid_payload";

    /// <summary>The entity is written by the server only (plan_version, exercise); clients can pull it but not push it.</summary>
    public const string ReadOnly = "read_only";

    /// <summary>A referenced row (session, exercise, plan version, parent set) is missing, deleted or belongs to another user.</summary>
    public const string InvalidReference = "invalid_reference";

    /// <summary>questionnaire_template: the user already has another live template (one per user).</summary>
    public const string TemplateConflict = "template_conflict";

    /// <summary>The database refused the row (a constraint the validation did not anticipate).</summary>
    public const string ConstraintViolation = "constraint_violation";

    /// <summary><c>invalid_payload:&lt;field&gt;</c>, the field in snake_case as sent by the client.</summary>
    public static string InvalidPayloadField(string field) => $"{InvalidPayload}:{field}";
}
