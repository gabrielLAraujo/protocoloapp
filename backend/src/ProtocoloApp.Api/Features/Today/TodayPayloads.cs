using System.Text.RegularExpressions;
using FluentValidation;
using ProtocoloApp.Api.Features.Plans;

namespace ProtocoloApp.Api.Features.Today;

// Payloads are snake_case JSON; every property is nullable so a missing field is reported as invalid_payload:<field>.

internal static partial class TodayPatterns
{
    // Exactly HH:mm, 00:00 to 23:59.
    [GeneratedRegex("^([01][0-9]|2[0-3]):[0-5][0-9]$")]
    public static partial Regex Time();

    [GeneratedRegex("^[A-Za-z0-9_:-]{1,64}$")]
    public static partial Regex Key();
}

/// <summary><c>schedule_slot</c>: <c>{slot, day_type, time, reminder_enabled}</c>; <c>day_type</c> is <c>training|off</c>, <c>time</c> is <c>HH:mm</c>.</summary>
public sealed record ScheduleSlotPayload
{
    public string? Slot { get; init; }

    public string? DayType { get; init; }

    public string? Time { get; init; }

    public bool? ReminderEnabled { get; init; }
}

public sealed class ScheduleSlotPayloadValidator : AbstractValidator<ScheduleSlotPayload>
{
    private static readonly IReadOnlyList<string> DayTypes = EnumText.Values<DayType>();

    public ScheduleSlotPayloadValidator()
    {
        RuleFor(p => p.Slot).Must(s => s is not null && TodayPatterns.Key().IsMatch(s)).OverridePropertyName("slot");
        RuleFor(p => p.DayType).Must(d => d is not null && DayTypes.Contains(d)).OverridePropertyName("day_type");
        RuleFor(p => p.Time).Must(t => t is not null && TodayPatterns.Time().IsMatch(t)).OverridePropertyName("time");
        RuleFor(p => p.ReminderEnabled).NotNull().OverridePropertyName("reminder_enabled");
    }
}

/// <summary>
/// <c>adherence_log</c>: <c>{date, target_type, target_key, status, reason?, note?}</c>; <c>target_type</c> is
/// <c>meal|protocol_item|cardio|workout|checkin</c>, <c>status</c> is <c>done|partial|missed</c>, <c>reason</c> is one of
/// <see cref="AdherenceLog.Reasons"/> and only allowed when the status is partial or missed.
/// </summary>
public sealed record AdherenceLogPayload
{
    public DateOnly? Date { get; init; }

    public string? TargetType { get; init; }

    public string? TargetKey { get; init; }

    public string? Status { get; init; }

    public string? Reason { get; init; }

    public string? Note { get; init; }
}

public sealed class AdherenceLogPayloadValidator : AbstractValidator<AdherenceLogPayload>
{
    private static readonly IReadOnlyList<string> TargetTypes = EnumText.Values<AdherenceTargetType>();
    private static readonly IReadOnlyList<string> Statuses = EnumText.Values<AdherenceStatus>();
    private static readonly string Done = EnumText.ToText(AdherenceStatus.Done);

    public AdherenceLogPayloadValidator()
    {
        RuleFor(p => p.Date).NotNull().OverridePropertyName("date");
        RuleFor(p => p.TargetType).Must(t => t is not null && TargetTypes.Contains(t)).OverridePropertyName("target_type");
        RuleFor(p => p.TargetKey).Must(k => k is not null && TodayPatterns.Key().IsMatch(k)).OverridePropertyName("target_key");
        RuleFor(p => p.Status).Must(s => s is not null && Statuses.Contains(s)).OverridePropertyName("status");
        RuleFor(p => p.Reason)
            .Must((p, reason) => reason is null || (AdherenceLog.Reasons.Contains(reason) && p.Status != Done))
            .OverridePropertyName("reason");
        RuleFor(p => p.Note).MaximumLength(AdherenceLog.MaxNoteLength).OverridePropertyName("note");
    }
}
