using System.Text.Json;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Updates;

/// <summary>
/// The user's questionnaire template: one live row per user (<see cref="Sync.SyncErrors.TemplateConflict"/>), edited on the
/// device and synced. Its document is the coach's content: it never goes to the logs.
/// </summary>
public sealed class QuestionnaireTemplate : ISyncEntity
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>A <see cref="QuestionnaireTemplateDocument"/> as the device sent it (camelCase), column <c>jsonb</c>.</summary>
    public JsonDocument Document { get; set; } = JsonDocument.Parse("{}");
}
