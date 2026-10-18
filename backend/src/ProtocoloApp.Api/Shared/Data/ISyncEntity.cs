namespace ProtocoloApp.Api.Shared.Data;

/// <summary>
/// A row that is synchronized with the offline clients. The id is generated on the client; the server owns
/// <see cref="Version"/> (a global, monotonically increasing number from <see cref="SyncVersion"/>), the timestamps and
/// the ownership.
/// </summary>
public interface ISyncEntity
{
    /// <summary>Client-generated id. It belongs to the user who first pushed it, forever.</summary>
    Guid Id { get; }

    Guid UserId { get; }

    /// <summary>Server version of the last applied change. Pull returns rows with a version greater than the client's cursor.</summary>
    long Version { get; set; }

    /// <summary>When the client made the last applied change (last-write-wins key), truncated to microseconds, UTC.</summary>
    DateTimeOffset ClientUpdatedAt { get; set; }

    /// <summary>Soft delete, kept so the deletion reaches the other devices.</summary>
    DateTimeOffset? DeletedAt { get; set; }

    /// <summary>Server clock, when the row was first stored.</summary>
    DateTimeOffset CreatedAt { get; set; }

    /// <summary>Server clock, when a change was last applied.</summary>
    DateTimeOffset UpdatedAt { get; set; }
}
