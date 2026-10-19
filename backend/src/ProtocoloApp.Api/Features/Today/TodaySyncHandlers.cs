using System.Globalization;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Today;

/// <summary>Syncs <see cref="ScheduleSlot"/> as <c>schedule_slot</c>.</summary>
public sealed class ScheduleSlotSyncHandler(AppDbContext db, TimeProvider clock)
    : SyncHandler<ScheduleSlot, ScheduleSlotPayload>(db, clock)
{
    public const string EntityName = "schedule_slot";

    private const string TimeFormat = "HH':'mm";

    private static readonly ScheduleSlotPayloadValidator PayloadValidator = new();

    public override string Entity => EntityName;

    protected override IValidator<ScheduleSlotPayload> Validator => PayloadValidator;

    protected override ScheduleSlot Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    protected override void Apply(ScheduleSlotPayload payload, ScheduleSlot entity)
    {
        entity.Slot = payload.Slot!;
        entity.DayType = EnumText.Parse<DayType>(payload.DayType!);
        // The validator already guarantees HH:mm; TryParse keeps a bad value from ever becoming a 500.
        entity.Time = TimeOnly.TryParseExact(payload.Time, TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)
            ? time
            : default;
        entity.ReminderEnabled = payload.ReminderEnabled!.Value;
    }

    protected override ScheduleSlotPayload CreatePayload(ScheduleSlot entity) => new()
    {
        Slot = entity.Slot,
        DayType = EnumText.ToText(entity.DayType),
        Time = entity.Time.ToString(TimeFormat, CultureInfo.InvariantCulture),
        ReminderEnabled = entity.ReminderEnabled,
    };

    // A different id for a (slot, day type) that already has a live row is refused.
    protected override async Task<string?> FindConflictAsync(ScheduleSlot entity, CancellationToken cancellationToken) =>
        await Db.ScheduleSlots.AnyAsync(
            s => s.UserId == entity.UserId && s.Slot == entity.Slot && s.DayType == entity.DayType && s.DeletedAt == null && s.Id != entity.Id,
            cancellationToken)
            ? SyncErrors.SlotConflict
            : null;
}

/// <summary>Syncs <see cref="AdherenceLog"/> as <c>adherence_log</c>.</summary>
public sealed class AdherenceLogSyncHandler(AppDbContext db, TimeProvider clock)
    : SyncHandler<AdherenceLog, AdherenceLogPayload>(db, clock)
{
    public const string EntityName = "adherence_log";

    private static readonly AdherenceLogPayloadValidator PayloadValidator = new();

    public override string Entity => EntityName;

    protected override IValidator<AdherenceLogPayload> Validator => PayloadValidator;

    protected override AdherenceLog Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    protected override void Apply(AdherenceLogPayload payload, AdherenceLog entity)
    {
        entity.Date = payload.Date!.Value;
        entity.TargetType = EnumText.Parse<AdherenceTargetType>(payload.TargetType!);
        entity.TargetKey = payload.TargetKey!;
        entity.Status = EnumText.Parse<AdherenceStatus>(payload.Status!);
        entity.Reason = payload.Reason;
        entity.Note = payload.Note;
    }

    protected override AdherenceLogPayload CreatePayload(AdherenceLog entity) => new()
    {
        Date = entity.Date,
        TargetType = EnumText.ToText(entity.TargetType),
        TargetKey = entity.TargetKey,
        Status = EnumText.ToText(entity.Status),
        Reason = entity.Reason,
        Note = entity.Note,
    };

    protected override async Task<string?> FindConflictAsync(AdherenceLog entity, CancellationToken cancellationToken) =>
        await Db.AdherenceLogs.AnyAsync(
            a => a.UserId == entity.UserId && a.Date == entity.Date && a.TargetType == entity.TargetType
                && a.TargetKey == entity.TargetKey && a.DeletedAt == null && a.Id != entity.Id,
            cancellationToken)
            ? SyncErrors.SlotConflict
            : null;
}
