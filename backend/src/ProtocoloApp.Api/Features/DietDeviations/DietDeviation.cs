using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.DietDeviations;

/// <summary>
/// Something eaten outside the diet on a date: inside a planned meal (<see cref="MealKey"/>) or as an extra meal (no key).
/// Several per meal and day. Its texts are domain content: they never go to the logs.
/// </summary>
public sealed class DietDeviation : ISyncEntity
{
    public const int MaxKeyLength = 64;
    public const int MaxDescriptionLength = 200;
    public const int MaxQuantityLength = 60;

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>The user's local day.</summary>
    public DateOnly Date { get; set; }

    /// <summary>The protocol meal it happened in; null for a meal outside the plan.</summary>
    public string? MealKey { get; set; }

    /// <summary>When it was eaten (used by the extra meal); null when not given.</summary>
    public TimeOnly? Time { get; set; }

    public string Description { get; set; } = "";

    public string? Quantity { get; set; }
}
