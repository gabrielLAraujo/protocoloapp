using System.Text.Json;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

public enum PlanKind
{
    Protocol,
    Workout,
}

public enum PlanStatus
{
    Draft,
    Active,
    Archived,
}

/// <summary>
/// One version of the protocol or of the workout plan (spec 3.1). Created and changed by the server only; clients receive
/// it by pull, without <see cref="RawExtraction"/>.
/// </summary>
public sealed class PlanVersion : ISyncEntity
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public PlanKind Kind { get; set; }

    public PlanStatus Status { get; set; }

    public Guid SourceFileId { get; set; }

    /// <summary>The typed document (<see cref="ProtocolDocument"/> or <see cref="WorkoutDocument"/>, camelCase JSON), column <c>jsonb</c>.</summary>
    public JsonDocument Document { get; set; } = JsonDocument.Parse("{}");

    /// <summary>The AI's raw answer, kept for audit. Never sent to the client.</summary>
    public JsonDocument? RawExtraction { get; set; }

    /// <summary>JSON paths of the document the extraction was unsure about.</summary>
    public string[] LowConfidence { get; set; } = [];

    /// <summary>Why the extraction failed (the document is then an empty draft); null when it worked.</summary>
    public string? ExtractionError { get; set; }

    public DateTimeOffset? ActivatedAt { get; set; }
}
