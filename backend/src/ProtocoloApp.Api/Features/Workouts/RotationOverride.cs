using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Workouts;

/// <summary>Replaces what the rotation says for one date: a workout day key, or <see cref="Off"/>.</summary>
public sealed class RotationOverride : ISyncEntity
{
    /// <summary>The key meaning "rest day".</summary>
    public const string Off = "off";

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public DateOnly Date { get; set; }

    public string WorkoutDayKey { get; set; } = "";
}
