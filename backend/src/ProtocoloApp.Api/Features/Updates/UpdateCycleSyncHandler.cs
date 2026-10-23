using FluentValidation;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Updates;

/// <summary>
/// Syncs <see cref="UpdateCycle"/> as <c>update_cycle</c>. The server creates the cycles (<see cref="UpdateCycles"/>): a push
/// of an unknown id, or a delete, is <c>read_only</c>. A push changes only <c>status</c>, <c>answers</c>, <c>photos</c> and
/// <c>sent_at</c>; the period and the protocol version sent by the device are ignored.
/// </summary>
public sealed class UpdateCycleSyncHandler(AppDbContext db, TimeProvider clock)
    : SyncHandler<UpdateCycle, UpdateCyclePayload>(db, clock)
{
    public const string EntityName = "update_cycle";

    private static readonly UpdateCyclePayloadValidator PayloadValidator = new();

    public override string Entity => EntityName;

    protected override IValidator<UpdateCyclePayload> Validator => PayloadValidator;

    protected override bool ClientCreatesAndDeletes => false;

    // Never reached for a new row (ClientCreatesAndDeletes is false); the server fields are set by UpdateCycles.
    protected override UpdateCycle Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    protected override void Apply(UpdateCyclePayload payload, UpdateCycle entity)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(entity);

        entity.Status = EnumText.Parse<UpdateCycleStatus>(payload.Status!);
        entity.Answers = UpdateCycles.WriteAnswers(payload.Answers);
        entity.Photos = UpdateCycles.WritePhotos(payload.Photos);
        var entry = Db.Entry(entity);
        if (entry.State is EntityState.Unchanged or EntityState.Modified)
        {
            entry.Property(c => c.Answers).IsModified = true;
            entry.Property(c => c.Photos).IsModified = true;
        }
    }

    protected override bool ApplyChange(UpdateCyclePayload payload, UpdateCycle entity, SyncChange change)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(entity);
        ArgumentNullException.ThrowIfNull(change);

        Apply(payload, entity);
        // Sent: when the device says, else when it was first sent, else the time of this change.
        entity.SentAt = entity.Status == UpdateCycleStatus.Sent ? payload.SentAt ?? entity.SentAt ?? change.ClientUpdatedAt : null;
        entity.ClientUpdatedAt = change.ClientUpdatedAt;
        return true;
    }

    protected override UpdateCyclePayload CreatePayload(UpdateCycle entity)
    {
        ArgumentNullException.ThrowIfNull(entity);

        return new UpdateCyclePayload
        {
            ProtocolVersionId = entity.ProtocolVersionId,
            PeriodStart = entity.PeriodStart,
            PeriodEnd = entity.PeriodEnd,
            Status = EnumText.ToText(entity.Status),
            Answers = UpdateCycles.ReadAnswers(entity),
            Photos = UpdateCycles.ReadPhotos(entity),
            SentAt = entity.SentAt,
        };
    }

    // Each photo must be a confirmed photo file of the user.
    protected override async Task<string?> ValidateReferencesAsync(UpdateCycle entity, Guid userId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(entity);

        var ids = UpdateCycles.ReadPhotos(entity).Select(p => p.FileId!.Value).Distinct().ToList();
        if (ids.Count == 0)
            return null;

        var found = await Db.Files.CountAsync(
            f => ids.Contains(f.Id) && f.UserId == userId && f.Kind == FileKind.Photo && f.Status == FileStatus.Confirmed,
            cancellationToken);
        return found == ids.Count ? null : SyncErrors.InvalidReference;
    }
}
