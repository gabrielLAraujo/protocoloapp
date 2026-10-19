using ProtocoloApp.Api.Features.Plans;

namespace ProtocoloApp.Api.Features.Today;

public enum DayKind
{
    Training,
    Off,
    None,
}

public sealed record WorkoutPlanAt(DateTimeOffset ActivatedAt, DateOnly ActivatedOn, RotationDto? Rotation);

public sealed record RotationOverrideRow(DateOnly Date, string WorkoutDayKey);

public sealed record ScheduleSlotRow(string Slot, DayType DayType, TimeOnly Time, bool ReminderEnabled);

public sealed record DayTarget(AdherenceTargetType Type, string Key, string Label, string? SlotKey, TimeOnly? Time, bool ReminderEnabled);

public sealed record DayPlan(DayKind DayType, string? WorkoutDayKey, IReadOnlyList<DayTarget> Targets);

public static class DayPlanner
{
    public static DayPlan Build(
        DateOnly date,
        ProtocolDocument? protocol,
        IReadOnlyList<WorkoutPlanAt> workouts,
        IReadOnlyList<RotationOverrideRow> overrides,
        IReadOnlyList<ScheduleSlotRow> slots,
        DateOnly? protocolActivatedOn = null) => new(DayKind.None, null, []);
}
