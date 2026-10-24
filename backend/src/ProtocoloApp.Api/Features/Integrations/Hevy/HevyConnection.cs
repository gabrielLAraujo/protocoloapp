using System.Text.Json;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>A user's connection to Hevy (one per user): the encrypted API key and the state of the import. Not synchronized.</summary>
public sealed class HevyConnection
{
    public const int KeyLast4Length = 4;
    public const int MaxLastErrorLength = 32;

    public Guid UserId { get; set; }

    /// <summary>The API key encrypted with AES-GCM: <c>0x01 | nonce(12) | cipher | tag(16)</c>. Never logged nor returned.</summary>
    public byte[] ApiKeyCipher { get; set; } = [];

    /// <summary>The last 4 characters of the key, the only part the status shows.</summary>
    public string KeyLast4 { get; set; } = "";

    /// <summary>Workouts starting before this local date are not imported.</summary>
    public DateOnly SyncFrom { get; set; }

    /// <summary>The <c>since</c> of the next incremental run; null until a run finishes without error.</summary>
    public DateTimeOffset? Cursor { get; set; }

    public DateTimeOffset? LastAttemptAt { get; set; }

    public DateTimeOffset? LastSuccessAt { get; set; }

    /// <summary>Code of the last run's error (<c>unauthorized</c>, <c>rate_limited</c>...), null when it succeeded.</summary>
    public string? LastError { get; set; }

    /// <summary>The counts of the last run (<c>jsonb</c>).</summary>
    public JsonDocument? LastResult { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
