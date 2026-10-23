using System.Text.Json;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Updates;

public enum UpdateCycleStatus
{
    Collecting,
    Draft,
    Sent,
}

/// <summary>
/// One update cycle: from the activation of a protocol version to its update date. Created by the server
/// (<see cref="UpdateCycles"/>); the device only changes <see cref="Status"/>, <see cref="Answers"/>, <see cref="Photos"/>
/// and <see cref="SentAt"/>. The answers are domain content: they never go to the logs.
/// </summary>
public sealed class UpdateCycle : ISyncEntity
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>The protocol <see cref="Plans.PlanVersion"/> the cycle belongs to (one cycle per version).</summary>
    public Guid ProtocolVersionId { get; set; }

    /// <summary>Local date (America/Sao_Paulo) of the protocol's activation.</summary>
    public DateOnly PeriodStart { get; set; }

    /// <summary>The protocol's update date.</summary>
    public DateOnly PeriodEnd { get; set; }

    public UpdateCycleStatus Status { get; set; }

    /// <summary>A JSON object <c>question key -> text</c>, column <c>jsonb</c>.</summary>
    public JsonDocument Answers { get; set; } = JsonDocument.Parse("{}");

    /// <summary>A JSON array <c>[{pose, file_id, taken_at}]</c> (snake_case), column <c>jsonb</c>.</summary>
    public JsonDocument Photos { get; set; } = JsonDocument.Parse("[]");

    public DateTimeOffset? SentAt { get; set; }
}
