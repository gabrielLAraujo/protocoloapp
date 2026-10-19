using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Today;

/// <summary>Kind of day a schedule applies to (<c>training</c> or <c>off</c>).</summary>
public enum DayType
{
    Training,
    Off,
}

/// <summary>The time of day (and reminder switch) of one slot (<c>meal_1</c>, <c>cardio</c>...) for one kind of day.</summary>
public sealed class ScheduleSlot : ISyncEntity
{
    public const int MaxSlotLength = 64;

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public string Slot { get; set; } = "";

    public DayType DayType { get; set; }

    /// <summary>Local time of day, column <c>time without time zone</c>.</summary>
    public TimeOnly Time { get; set; }

    public bool ReminderEnabled { get; set; }
}
