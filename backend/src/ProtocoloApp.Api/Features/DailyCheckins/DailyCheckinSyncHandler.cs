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

    public override string Entity => EntityName;

    protected override IValidator<DailyCheckinPayload> Validator => PayloadValidator;

    protected override DailyCheckin Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    // Field-wise merge (the check-in is saved in parts, possibly from different devices before a pull): a null field keeps the
    // stored value, a present one replaces it. "" clears the note. The base class has already applied the stale rule (an
    // older client_updated_at never gets here). Only called with a payload the validator accepted.
    protected override void Apply(DailyCheckinPayload payload, DailyCheckin entity)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(entity);

        // A newer upsert revives a soft-deleted row: the deleted values must not leak into the new check-in.
        if (entity.DeletedAt is not null)
            ClearFields(entity);

        entity.Date = payload.Date!.Value;
        entity.SleepQuality = payload.SleepQuality ?? entity.SleepQuality;
        entity.Bowel = payload.Bowel is null ? entity.Bowel : BowelText.Parse(payload.Bowel);
        entity.EnergyWake = payload.EnergyWake ?? entity.EnergyWake;
        entity.EnergyDay = payload.EnergyDay ?? entity.EnergyDay;
        entity.Anxiety = payload.Anxiety ?? entity.Anxiety;
        entity.WaterL = payload.WaterL ?? entity.WaterL;
        entity.WeightKg = payload.WeightKg ?? entity.WeightKg;
        if (payload.Note is not null)
            entity.Note = payload.Note.Length == 0 ? null : payload.Note;
        entity.CardioDone = payload.CardioDone ?? entity.CardioDone;
        entity.CardioMinutes = payload.CardioMinutes ?? entity.CardioMinutes;
        // Minutes only make sense with cardio done (also a check constraint): "not done" drops minutes stored earlier.
        if (entity.CardioDone != true)
            entity.CardioMinutes = null;
    }

    private static void ClearFields(DailyCheckin entity)
    {
        entity.SleepQuality = null;
        entity.Bowel = null;
        entity.EnergyWake = null;
        entity.EnergyDay = null;
        entity.Anxiety = null;
        entity.WaterL = null;
        entity.WeightKg = null;
        entity.Note = null;
        entity.CardioDone = null;
        entity.CardioMinutes = null;
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
