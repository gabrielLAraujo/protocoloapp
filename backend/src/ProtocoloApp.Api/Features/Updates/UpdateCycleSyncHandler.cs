using FluentValidation;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Updates;

/// <summary>
/// Syncs <see cref="UpdateCycle"/> as <c>update_cycle</c>. The server creates the cycles (<see cref="UpdateCycles"/>): a push
/// of an unknown id, or a delete, is <c>read_only</c>. A push changes only <c>status</c>, the answers, the photos and
/// <c>sent_at</c>; the period and the protocol version sent by the device are ignored.
/// <para>
/// Merged field by field, never row by row: two devices answering different questions (or photographing different poses)
/// must both keep their work. Each answer key and each pose has its own client clock (<c>answer_entries[key].at</c>,
/// <c>photos[].updated_at</c>) and the newer one wins; a removed answer (<c>text</c> null) with a newer clock removes it.
/// The status only moves forward (collecting, draft, sent). A change that makes nothing newer is <c>stale</c>.
/// </para>
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

    // Per-entry clocks: a change may be older than the row (whose clock is the latest entry's) and still carry a newer
    // answer or photo, so only a change not newer than the cycle's creation is stale up front; ApplyChange decides the rest.
    protected override bool IsStale(UpdateCycle existing, SyncChange change)
    {
        ArgumentNullException.ThrowIfNull(existing);
        ArgumentNullException.ThrowIfNull(change);

        return change.Op == SyncOp.Delete ? base.IsStale(existing, change) : change.ClientUpdatedAt <= existing.CreatedAt;
    }

    // Whole payload over the row, dated by the row's own clock (the sync engine calls ApplyChange, which merges).
    protected override void Apply(UpdateCyclePayload payload, UpdateCycle entity)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(entity);

        entity.Status = EnumText.Parse<UpdateCycleStatus>(payload.Status!);
        var at = entity.ClientUpdatedAt;
        var entries = Incoming(payload, new Dictionary<string, UpdateCycleAnswerDto>(StringComparer.Ordinal), at)
            .ToDictionary(e => e.Key, e => new UpdateCycleAnswerDto { Text = e.Value.Text, At = Clamp(e.Value.At, at) }, StringComparer.Ordinal);
        var photos = (payload.Photos ?? []).OfType<UpdateCyclePhotoDto>().Select(p => p with { UpdatedAt = Clamp(p.UpdatedAt, at) });
        Write(entity, entries, photos);
    }

    protected override bool ApplyChange(UpdateCyclePayload payload, UpdateCycle entity, SyncChange change)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(entity);
        ArgumentNullException.ThrowIfNull(change);

        var at = change.ClientUpdatedAt;
        // What a key or pose never written before competes with: the cycle's creation.
        var floor = entity.CreatedAt;
        var changed = false;

        var entries = UpdateCycles.ReadAnswerEntries(entity);
        foreach (var (key, incoming) in Incoming(payload, entries, at))
        {
            var when = Clamp(incoming.At, at);
            var current = entries.TryGetValue(key, out var stored) ? stored.At!.Value : floor;
            if (when <= current)
                continue;
            entries[key] = new UpdateCycleAnswerDto { Text = incoming.Text, At = when };
            changed = true;
        }

        var photos = UpdateCycles.ReadPhotos(entity).ToDictionary(p => p.Pose!, p => p with { UpdatedAt = p.UpdatedAt ?? entity.ClientUpdatedAt }, StringComparer.Ordinal);
        foreach (var photo in (payload.Photos ?? []).OfType<UpdateCyclePhotoDto>())
        {
            var when = Clamp(photo.UpdatedAt, at);
            var current = photos.TryGetValue(photo.Pose!, out var stored) ? stored.UpdatedAt!.Value : floor;
            if (when <= current)
                continue;
            photos[photo.Pose!] = photo with { UpdatedAt = when };
            changed = true;
        }

        var status = EnumText.Parse<UpdateCycleStatus>(payload.Status!);
        if (status > entity.Status)
        {
            entity.Status = status;
            changed = true;
        }

        if (!changed)
            return false;

        Write(entity, entries, photos.Values);
        // Sent: when it was first sent, else when the device says, else the time of this change.
        entity.SentAt = entity.Status == UpdateCycleStatus.Sent ? entity.SentAt ?? payload.SentAt ?? at : null;
        if (at > entity.ClientUpdatedAt)
            entity.ClientUpdatedAt = at;
        return true;
    }

    /// <summary>
    /// The answers a push carries, each with its clock: <c>answer_entries</c> when present; else (an older app) every key of
    /// <c>answers</c> at the change's time, and every live stored answer it left out as removed at that time.
    /// </summary>
    private static IEnumerable<KeyValuePair<string, UpdateCycleAnswerDto>> Incoming(
        UpdateCyclePayload payload, IReadOnlyDictionary<string, UpdateCycleAnswerDto> stored, DateTimeOffset at)
    {
        if (payload.AnswerEntries is not null)
        {
            return payload.AnswerEntries
                .Where(e => e.Value is not null)
                .Select(e => KeyValuePair.Create(e.Key, e.Value!))
                .ToList();
        }

        if (payload.Answers is null)
            return [];

        var legacy = payload.Answers.ToDictionary(a => a.Key, a => new UpdateCycleAnswerDto { Text = a.Value, At = at }, StringComparer.Ordinal);
        foreach (var (key, entry) in stored)
        {
            if (entry.Text is not null && !legacy.ContainsKey(key))
                legacy[key] = new UpdateCycleAnswerDto { Text = null, At = at };
        }

        return legacy.ToList();
    }

    // A device clock never dates an entry after the change that carries it.
    private static DateTimeOffset Clamp(DateTimeOffset? entryAt, DateTimeOffset changeAt) =>
        entryAt is { } value && value < changeAt ? value : changeAt;

    private void Write(UpdateCycle entity, IReadOnlyDictionary<string, UpdateCycleAnswerDto> entries, IEnumerable<UpdateCyclePhotoDto> photos)
    {
        entity.Answers = UpdateCycles.WriteAnswerEntries(entries);
        entity.Photos = UpdateCycles.WritePhotos(photos.OrderBy(p => p.Pose, StringComparer.Ordinal));
        var entry = Db.Entry(entity);
        if (entry.State is EntityState.Unchanged or EntityState.Modified)
        {
            entry.Property(c => c.Answers).IsModified = true;
            entry.Property(c => c.Photos).IsModified = true;
        }
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
            AnswerEntries = UpdateCycles.ReadAnswerEntries(entity).ToDictionary(e => e.Key, e => (UpdateCycleAnswerDto?)e.Value, StringComparer.Ordinal),
            Photos = UpdateCycles.ReadPhotos(entity).Select(p => p with { UpdatedAt = p.UpdatedAt ?? entity.ClientUpdatedAt }).ToList(),
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
