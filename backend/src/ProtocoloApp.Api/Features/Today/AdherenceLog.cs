using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Today;

public enum AdherenceTargetType
{
    Meal,
    ProtocolItem,
    Cardio,
    Workout,
    Checkin,
}

public enum AdherenceStatus
{
    Done,
    Partial,
    Missed,
}

/// <summary>Whether the user did a target (meal, protocol item, cardio, workout, check-in) on a date.</summary>
public sealed class AdherenceLog : ISyncEntity
{
    public const int MaxKeyLength = 64;
    public const int MaxReasonLength = 32;
    public const int MaxNoteLength = 500;

    /// <summary>The reasons a partial or missed target may carry.</summary>
    public static readonly IReadOnlyList<string> Reasons = ["no_appetite", "no_time", "felt_sick", "free_meal", "other"];

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public DateOnly Date { get; set; }

    public AdherenceTargetType TargetType { get; set; }

    public string TargetKey { get; set; } = "";

    public AdherenceStatus Status { get; set; }

    public string? Reason { get; set; }

    public string? Note { get; set; }
}
