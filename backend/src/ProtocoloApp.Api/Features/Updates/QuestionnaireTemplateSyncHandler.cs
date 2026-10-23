using System.Text.Json;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Updates;

/// <summary>
/// Syncs <see cref="QuestionnaireTemplate"/> as <c>questionnaire_template</c>. The document is stored as sent; a second live
/// template of the same user is <see cref="SyncErrors.TemplateConflict"/>.
/// </summary>
public sealed class QuestionnaireTemplateSyncHandler(AppDbContext db, TimeProvider clock)
    : SyncHandler<QuestionnaireTemplate, QuestionnaireTemplatePayload>(db, clock)
{
    public const string EntityName = "questionnaire_template";

    private static readonly QuestionnaireTemplatePayloadValidator PayloadValidator = new();

    public override string Entity => EntityName;

    protected override IValidator<QuestionnaireTemplatePayload> Validator => PayloadValidator;

    protected override QuestionnaireTemplate Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    protected override void Apply(QuestionnaireTemplatePayload payload, QuestionnaireTemplate entity)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(entity);

        // Validated: an object.
        entity.Document = JsonDocument.Parse(payload.Document!.Value.GetRawText());
        var entry = Db.Entry(entity);
        if (entry.State is EntityState.Unchanged or EntityState.Modified)
            entry.Property(t => t.Document).IsModified = true;
    }

    protected override QuestionnaireTemplatePayload CreatePayload(QuestionnaireTemplate entity)
    {
        ArgumentNullException.ThrowIfNull(entity);

        return new QuestionnaireTemplatePayload { Document = entity.Document.RootElement.Clone() };
    }

    protected override async Task<string?> FindConflictAsync(QuestionnaireTemplate entity, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(entity);

        var taken = await Db.QuestionnaireTemplates.AnyAsync(
            t => t.UserId == entity.UserId && t.DeletedAt == null && t.Id != entity.Id,
            cancellationToken);
        return taken ? SyncErrors.TemplateConflict : null;
    }
}
