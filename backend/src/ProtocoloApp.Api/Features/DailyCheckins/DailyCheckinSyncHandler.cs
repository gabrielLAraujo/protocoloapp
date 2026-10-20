using FluentValidation;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.DailyCheckins;

/// <summary>Syncs <see cref="DailyCheckin"/> as <c>daily_checkin</c>. Payload: <see cref="DailyCheckinPayload"/>.</summary>
public sealed class DailyCheckinSyncHandler(AppDbContext db, TimeProvider clock)
    : SyncHandler<DailyCheckin, DailyCheckinPayload>(db, clock)
{
    public const string EntityName = "daily_checkin";

    private static readonly DailyCheckinPayloadValidator PayloadValidator = new();

    private static readonly DailyCheckinPayload Empty = new();

    public override string Entity => EntityName;

    protected override IValidator<DailyCheckinPayload> Validator => PayloadValidator;

    protected override DailyCheckin Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    // Per-part last-write-wins. A change may be older than the row (whose clock is the latest part clock) and still newer
    // than one of its parts: the morning saved offline on the phone at t1 reaches the server after the evening saved on the
    // PC at t2 > t1. So the row is stale only when the change is not newer than any part; ApplyChange decides per part.
    protected override bool IsStale(DailyCheckin existing, SyncChange change)
    {
        ArgumentNullException.ThrowIfNull(existing);
        ArgumentNullException.ThrowIfNull(change);

        // A delete, or a write over a deleted row, competes with the whole row.
        if (change.Op == SyncOp.Delete || existing.DeletedAt is not null)
            return base.IsStale(existing, change);

        var at = change.ClientUpdatedAt;
        return !(IsNewer(at, existing.MorningClientUpdatedAt)
            || IsNewer(at, existing.EveningClientUpdatedAt)
            || IsNewer(at, existing.CardioClientUpdatedAt));
    }

    protected override bool ApplyChange(DailyCheckinPayload payload, DailyCheckin entity, SyncChange change)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(entity);
        ArgumentNullException.ThrowIfNull(change);

        // A newer upsert revives a soft-deleted row (base IsStale already checked it is newer than the delete): it starts
        // from nothing, so the deleted values and clocks do not leak into the new check-in.
        if (entity.DeletedAt is not null)
            Clear(entity);

        var at = change.ClientUpdatedAt;
        var morning = payload.Writes(CheckinPart.Morning) && IsNewer(at, entity.MorningClientUpdatedAt);
        var evening = payload.Writes(CheckinPart.Evening) && IsNewer(at, entity.EveningClientUpdatedAt);
        var cardio = payload.Writes(CheckinPart.Cardio) && IsNewer(at, entity.CardioClientUpdatedAt);
        if (!morning && !evening && !cardio)
            return false;

        entity.Date = payload.Date!.Value;
        if (morning)
        {
            WriteMorning(payload, entity);
            entity.MorningClientUpdatedAt = at;
        }

        if (evening)
        {
            WriteEvening(payload, entity);
            entity.EveningClientUpdatedAt = at;
        }

        if (cardio)
        {
            WriteCardio(payload, entity);
            entity.CardioClientUpdatedAt = at;
        }

        entity.ClientUpdatedAt = new[] { entity.MorningClientUpdatedAt, entity.EveningClientUpdatedAt, entity.CardioClientUpdatedAt }
            .Max()!.Value;
        return true;
    }

    // The parts the payload lists, without the clocks (ApplyChange is what the sync engine calls).
    protected override void Apply(DailyCheckinPayload payload, DailyCheckin entity)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(entity);

        entity.Date = payload.Date!.Value;
        if (payload.Writes(CheckinPart.Morning))
            WriteMorning(payload, entity);
        if (payload.Writes(CheckinPart.Evening))
            WriteEvening(payload, entity);
        if (payload.Writes(CheckinPart.Cardio))
            WriteCardio(payload, entity);
    }

    private static bool IsNewer(DateTimeOffset at, DateTimeOffset? clock) => clock is null || at > clock.Value;

    // Each part replaces all of its fields: null clears.
    private static void WriteMorning(DailyCheckinPayload payload, DailyCheckin entity)
    {
        entity.SleepQuality = payload.SleepQuality;
        entity.EnergyWake = payload.EnergyWake;
        entity.Bowel = payload.Bowel is null ? null : BowelText.Parse(payload.Bowel);
        entity.WeightKg = payload.WeightKg;
    }

    private static void WriteEvening(DailyCheckinPayload payload, DailyCheckin entity)
    {
        entity.EnergyDay = payload.EnergyDay;
        entity.Anxiety = payload.Anxiety;
        entity.WaterL = payload.WaterL;
        entity.Note = payload.Note;
    }

    private static void WriteCardio(DailyCheckinPayload payload, DailyCheckin entity)
    {
        entity.CardioDone = payload.CardioDone;
        entity.CardioMinutes = payload.CardioMinutes;
    }

    private static void Clear(DailyCheckin entity)
    {
        WriteMorning(Empty, entity);
        WriteEvening(Empty, entity);
        WriteCardio(Empty, entity);
        entity.MorningClientUpdatedAt = null;
        entity.EveningClientUpdatedAt = null;
        entity.CardioClientUpdatedAt = null;
    }

    protected override DailyCheckinPayload CreatePayload(DailyCheckin entity)
    {
        ArgumentNullException.ThrowIfNull(entity);

        return new DailyCheckinPayload
        {
            Date = entity.Date,
            SleepQuality = entity.SleepQuality,
            Bowel = entity.Bowel is { } bowel ? BowelText.ToText(bowel) : null,
            EnergyWake = entity.EnergyWake,
            EnergyDay = entity.EnergyDay,
            Anxiety = entity.Anxiety,
            WaterL = entity.WaterL,
            WeightKg = entity.WeightKg,
            Note = entity.Note,
            CardioDone = entity.CardioDone,
            CardioMinutes = entity.CardioMinutes,
        };
    }

    // Two devices creating "today" offline must agree on the id (the client derives it from the date). A different id for a
    // date that already has a live check-in is refused instead of duplicating the day; the unique index is the backstop.
    protected override async Task<string?> FindConflictAsync(DailyCheckin entity, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(entity);

        var taken = await Db.DailyCheckins.AnyAsync(
            c => c.UserId == entity.UserId && c.Date == entity.Date && c.DeletedAt == null && c.Id != entity.Id,
            cancellationToken);
        return taken ? SyncErrors.DateConflict : null;
    }
}
