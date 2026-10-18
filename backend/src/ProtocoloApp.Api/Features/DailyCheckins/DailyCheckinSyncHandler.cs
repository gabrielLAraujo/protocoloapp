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

    // Only called with a payload the validator accepted: the required fields are present.
    protected override void Apply(DailyCheckinPayload payload, DailyCheckin entity)
    {
        ArgumentNullException.ThrowIfNull(payload);
        ArgumentNullException.ThrowIfNull(entity);

        entity.Date = payload.Date!.Value;
        entity.SleepQuality = payload.SleepQuality!.Value;
        entity.Bowel = BowelText.Parse(payload.Bowel!);
        entity.EnergyWake = payload.EnergyWake!.Value;
        entity.EnergyDay = payload.EnergyDay!.Value;
        entity.Anxiety = payload.Anxiety!.Value;
        entity.WaterL = payload.WaterL!.Value;
        entity.WeightKg = payload.WeightKg;
        entity.Note = payload.Note;
    }

    protected override DailyCheckinPayload CreatePayload(DailyCheckin entity)
    {
        ArgumentNullException.ThrowIfNull(entity);

        return new DailyCheckinPayload
        {
            Date = entity.Date,
            SleepQuality = entity.SleepQuality,
            Bowel = BowelText.ToText(entity.Bowel),
            EnergyWake = entity.EnergyWake,
            EnergyDay = entity.EnergyDay,
            Anxiety = entity.Anxiety,
            WaterL = entity.WaterL,
            WeightKg = entity.WeightKg,
            Note = entity.Note,
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
