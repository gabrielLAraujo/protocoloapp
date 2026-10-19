using ProtocoloApp.Api.Features.Plans;

namespace ProtocoloApp.Api.Features.Today;

/// <summary>What a date resolves to: a workout day, a rest day, or no workout plan at all.</summary>
public enum DayKind
{
    Training,
    Off,
    None,
}

/// <summary>A workout version that was active: <c>ActivatedOn</c> is the local date (America/Sao_Paulo) of <c>ActivatedAt</c>.</summary>
public sealed record WorkoutPlanAt(DateTimeOffset ActivatedAt, DateOnly ActivatedOn, RotationDto? Rotation);

/// <summary>A manual choice for one date: a workout day key, or <see cref="RotationDto.Off"/>.</summary>
public sealed record RotationOverrideRow(DateOnly Date, string WorkoutDayKey);

public sealed record ScheduleSlotRow(string Slot, DayType DayType, TimeOnly Time, bool ReminderEnabled);

/// <summary>Something to do on a day. <c>SlotKey</c> null (timing <c>any</c>) means no time and no reminder.</summary>
public sealed record DayTarget(AdherenceTargetType Type, string Key, string Label, string? SlotKey, TimeOnly? Time, bool ReminderEnabled);

/// <summary>The plan of one date; <c>Targets</c> ordered by time (untimed last), then slot, key and type.</summary>
public sealed record DayPlan(DayKind DayType, string? WorkoutDayKey, IReadOnlyList<DayTarget> Targets);

/// <summary>
/// The day rules (spec "Hoje", section 2), the server twin of the front's <c>buildDay</c>: both run the shared
/// <c>fixtures/schedule-cases.json</c>. The rotation mirrors <c>frontend/src/domain/rotation.ts</c> exactly.
/// </summary>
public static class DayPlanner
{
    public const string CardioKey = "cardio";
    public const string WorkoutKey = "workout";
    // The two parts of the daily check-in are two targets; the evening one keeps the old "checkin" slot (and its time).
    public const string CheckinMorningKey = "checkin_morning";
    public const string CheckinEveningKey = "checkin_evening";
    public const string CheckinMorningSlot = "checkin_morning";
    public const string CheckinEveningSlot = "checkin";

    /// <summary>Adherence key of the single check-in target before it was split; a log with it counts as the evening check-in.</summary>
    public const string LegacyCheckinKey = "checkin";

    private const string WithMealPrefix = "with_meal:";

    private static readonly string[] TimingSlots = ["fasting", "after_meal", "before_bed", "pre_workout", "intra_workout", "post_workout"];

    private static readonly string[] WeekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

    /// <param name="protocolActivatedOn">Local date the protocol was activated: anchor of <c>every_n_days</c> items without one.</param>
    public static DayPlan Build(
        DateOnly date,
        ProtocolDocument? protocol,
        IReadOnlyList<WorkoutPlanAt> workouts,
        IReadOnlyList<RotationOverrideRow> overrides,
        IReadOnlyList<ScheduleSlotRow> slots,
        DateOnly? protocolActivatedOn = null)
    {
        ArgumentNullException.ThrowIfNull(workouts);
        ArgumentNullException.ThrowIfNull(overrides);
        ArgumentNullException.ThrowIfNull(slots);

        var (kind, dayKey) = ResolveDay(date, workouts, overrides);
        var training = kind == DayKind.Training;
        // A day without a workout plan uses the rest-day times.
        var slotDay = training ? DayType.Training : DayType.Off;
        var targets = new List<DayTarget>();

        void Add(AdherenceTargetType type, string key, string label, string? slot)
        {
            var row = slot is null ? null : slots.FirstOrDefault(s => s.Slot == slot && s.DayType == slotDay);
            targets.Add(new DayTarget(type, key, label, slot, row?.Time, row?.ReminderEnabled ?? false));
        }

        if (protocol is not null)
        {
            var meals = protocol.Meals ?? [];
            for (var i = 0; i < meals.Count; i++)
            {
                var meal = meals[i];
                Add(AdherenceTargetType.Meal, meal.Key, string.IsNullOrWhiteSpace(meal.Label) ? $"REF {i + 1}" : meal.Label, $"meal_{meal.Key}");
            }

            foreach (var item in protocol.Items ?? [])
            {
                if (IsScheduled(item.Schedule, date, training, protocolActivatedOn))
                    Add(AdherenceTargetType.ProtocolItem, item.Key, item.Name, SlotOf(item.Timing));
            }

            if (protocol.Cardio is { } cardio && (cardio.Daily == true || cardio.SessionsPerWeek > 0))
                Add(AdherenceTargetType.Cardio, CardioKey, "Cardio", "cardio");
        }

        if (training)
            Add(AdherenceTargetType.Workout, WorkoutKey, $"Treino {dayKey}", "workout");
        Add(AdherenceTargetType.Checkin, CheckinMorningKey, "Check-in da manhã", CheckinMorningSlot);
        Add(AdherenceTargetType.Checkin, CheckinEveningKey, "Check-in da noite", CheckinEveningSlot);

        // Order is stable, like Array.prototype.sort in the front.
        return new DayPlan(kind, training ? dayKey : null, targets.Order(Comparer<DayTarget>.Create(CompareTargets)).ToList());
    }

    /// <summary>
    /// The workout of <paramref name="date"/>: a direct override wins; otherwise the active version's rotation
    /// (<c>sequence</c> counted from its anchor, re-anchored by earlier overrides; <c>fixed_weekdays</c> by weekday).
    /// </summary>
    public static (DayKind Kind, string? DayKey) ResolveDay(
        DateOnly date, IReadOnlyList<WorkoutPlanAt> workouts, IReadOnlyList<RotationOverrideRow> overrides)
    {
        ArgumentNullException.ThrowIfNull(workouts);
        ArgumentNullException.ThrowIfNull(overrides);

        var plan = ActivePlanAt(date, workouts);
        if (plan is null)
            return (DayKind.None, null);

        var direct = overrides.FirstOrDefault(o => o.Date == date);
        if (direct is not null)
            return AsResult(direct.WorkoutDayKey);

        var rotation = plan.Rotation;
        if (rotation is null)
            return (DayKind.None, null);

        switch (rotation.Type)
        {
            case RotationDto.FixedWeekdays:
                if (rotation.Map is null)
                    return (DayKind.None, null);
                return AsResult(rotation.Map.TryGetValue(WeekdayKeys[(int)date.DayOfWeek], out var key) ? key : null);

            case RotationDto.Sequence:
                var items = rotation.Items ?? [];
                if (items.Count == 0)
                    return (DayKind.None, null);
                return AsResult(items[SequenceIndex(date, plan, rotation, items, overrides)]);

            default:
                return (DayKind.None, null);
        }
    }

    /// <summary>The version with the greatest <c>ActivatedOn &lt;= date</c>; same day: the greatest <c>ActivatedAt</c>, then the later entry.</summary>
    private static WorkoutPlanAt? ActivePlanAt(DateOnly date, IReadOnlyList<WorkoutPlanAt> workouts)
    {
        WorkoutPlanAt? active = null;
        foreach (var plan in workouts)
        {
            if (plan.ActivatedOn > date)
                continue;
            if (active is null || plan.ActivatedOn > active.ActivatedOn
                || (plan.ActivatedOn == active.ActivatedOn && plan.ActivatedAt >= active.ActivatedAt))
                active = plan;
        }

        return active;
    }

    private static (DayKind Kind, string? DayKey) AsResult(string? dayKey) =>
        string.IsNullOrEmpty(dayKey) || dayKey == RotationDto.Off ? (DayKind.Off, null) : (DayKind.Training, dayKey);

    /// <summary>
    /// Position in <paramref name="items"/> on <paramref name="date"/>. The anchor starts at the rotation's anchor (or the
    /// version's activation) at position 0; each earlier override inside the active version re-anchors it: a workout key
    /// moves to that key's occurrence nearest to where the rotation would have been, <c>off</c> postpones the rotation by
    /// one day unless that day was already a rest day.
    /// </summary>
    private static int SequenceIndex(
        DateOnly date, WorkoutPlanAt plan, RotationDto rotation, IReadOnlyList<string> items, IReadOnlyList<RotationOverrideRow> overrides)
    {
        var n = items.Count;
        var anchorDate = rotation.Anchor ?? plan.ActivatedOn;
        var anchorIndex = 0;
        // OrderBy is stable: same-date overrides keep their input order, as in the front.
        var anchors = overrides.Where(o => o.Date < date && o.Date >= plan.ActivatedOn).OrderBy(o => o.Date);
        foreach (var o in anchors)
        {
            var natural = Mod(anchorIndex + Days(anchorDate, o.Date), n);
            int next;
            if (o.WorkoutDayKey == RotationDto.Off)
            {
                next = items[natural] == RotationDto.Off ? natural : Mod(natural - 1, n);
            }
            else
            {
                var best = -1;
                var bestDistance = int.MaxValue;
                for (var i = 0; i < n; i++)
                {
                    if (items[i] != o.WorkoutDayKey)
                        continue;
                    var distance = Math.Min(Mod(i - natural, n), Mod(natural - i, n));
                    if (distance < bestDistance)
                    {
                        best = i;
                        bestDistance = distance;
                    }
                }

                if (best < 0)
                    continue;
                next = best;
            }

            anchorDate = o.Date;
            anchorIndex = next;
        }

        return Mod(anchorIndex + Days(anchorDate, date), n);
    }

    private static bool IsScheduled(ScheduleDto? schedule, DateOnly date, bool training, DateOnly? protocolActivatedOn)
    {
        if (schedule is null)
            return true;

        switch (schedule.Type ?? "daily")
        {
            case "daily":
                return true;
            case "weekdays":
                return schedule.Days?.Contains(WeekdayKeys[(int)date.DayOfWeek], StringComparer.Ordinal) == true;
            case "every_n_days":
                var anchor = schedule.Anchor ?? protocolActivatedOn;
                return schedule.N is { } n && n >= 1 && anchor is { } a && Mod(Days(a, date), n) == 0;
            case "training_days_only":
                return training;
            case "off_days_only":
                return !training;
            default:
                return false;
        }
    }

    private static string? SlotOf(string? timing)
    {
        if (timing is null)
            return null;
        if (timing.StartsWith(WithMealPrefix, StringComparison.Ordinal) && timing.Length > WithMealPrefix.Length)
            return $"meal_{timing[WithMealPrefix.Length..]}";
        return TimingSlots.Contains(timing, StringComparer.Ordinal) ? timing : null;
    }

    private static int CompareTargets(DayTarget a, DayTarget b)
    {
        // Untimed and slotless targets go last; strings compare ordinally (as JavaScript's < does).
        if (a.Time != b.Time)
        {
            if (a.Time is not { } ta)
                return 1;
            if (b.Time is not { } tb)
                return -1;
            return ta.CompareTo(tb);
        }

        if (!string.Equals(a.SlotKey, b.SlotKey, StringComparison.Ordinal))
        {
            if (a.SlotKey is null)
                return 1;
            if (b.SlotKey is null)
                return -1;
            return string.CompareOrdinal(a.SlotKey, b.SlotKey);
        }

        var byKey = string.CompareOrdinal(a.Key, b.Key);
        return byKey != 0 ? byKey : a.Type.CompareTo(b.Type);
    }

    private static int Days(DateOnly from, DateOnly to) => to.DayNumber - from.DayNumber;

    private static int Mod(int value, int m) => ((value % m) + m) % m;
}
