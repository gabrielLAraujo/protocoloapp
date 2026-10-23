using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.DietDeviations;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;

namespace ProtocoloApp.Api.Features.Updates.Metrics;

/// <summary>
/// What the adherence metrics read. <c>Days</c> are the cycle days (<c>period_start</c>..<c>min(period_end, today)</c>) with
/// their plan; the first one anchors the weeks. <c>MealLabels</c> maps a protocol meal key to its label and
/// <c>ItemCategories</c> a protocol item key to its category (<c>supplement</c>, <c>compound</c>…).
/// </summary>
public sealed record AdherenceInput(
    IReadOnlyList<(DateOnly Date, DayPlan Plan)> Days,
    DateOnly Today,
    IReadOnlyList<AdherenceLog> Logs,
    IReadOnlyList<DietDeviation> Deviations,
    IReadOnlyList<DailyCheckin> Checkins,
    ISet<DateOnly> WorkedOutDates,
    CardioPlanDto? Cardio,
    IReadOnlyDictionary<string, string> MealLabels,
    IReadOnlyDictionary<string, string>? ItemCategories = null);

/// <summary>Planned versus done; <c>ErrorPct</c> = round(100 × (planned − done) / planned), null when nothing was planned.</summary>
public sealed record Rate(int Planned, int Done, int? ErrorPct);

public sealed record WeekRate(int Week, DateOnly From, DateOnly To, int Planned, int Done, int? ErrorPct);

public sealed record DietErrorRate(Rate Cycle, IReadOnlyList<WeekRate> Weeks);

/// <summary><c>Reason</c>: a code of <see cref="AdherenceLog.Reasons"/>, <c>ran_out</c>, <c>unmarked</c> or <c>deviation</c>.</summary>
public sealed record ReasonCount(string Reason, int Count);

public sealed record WeekWrongMeals(int Week, DateOnly From, DateOnly To, int Count, IReadOnlyList<ReasonCount> Reasons);

/// <summary>A deviation of the cycle; <c>MealLabel</c> null for an extra meal (or a key no longer in the protocol).</summary>
public sealed record DietDeviationEntry(
    DateOnly Date, string? MealKey, string? MealLabel, TimeOnly? Time, string Description, string? Quantity);

public sealed record WeekWorkoutMisses(int Week, DateOnly From, DateOnly To, int Planned, int Done, IReadOnlyList<DateOnly> MissedDates);

/// <summary>The cycle's workouts; <c>Weeks</c> only has the weeks with a planned workout.</summary>
public sealed record WorkoutMisses(int Planned, int Done, IReadOnlyList<DateOnly> MissedDates, IReadOnlyList<WeekWorkoutMisses> Weeks);

public sealed record WeekCardioMisses(int Week, DateOnly From, DateOnly To, int Planned, int Done);

/// <summary>The cycle's cardio; <c>Weeks</c> only has the weeks with a planned session.</summary>
public sealed record CardioMisses(int Planned, int Done, IReadOnlyList<WeekCardioMisses> Weeks);

/// <summary><c>Category</c>: the protocol item's category, null when the item is no longer in the protocol.</summary>
public sealed record ItemMisses(string Key, string Name, string? Category, int Missed, IReadOnlyList<ReasonCount> Reasons);

/// <summary>
/// A protocol item used in the cycle (at least one day done or partial): <c>Planned</c> days with the item (today only when
/// marked), of which <c>Done</c> done and <c>Partial</c> partial.
/// </summary>
public sealed record ItemUse(string Key, string Name, string? Category, int Done, int Partial, int Planned);

public sealed record AdherenceResult(
    DietErrorRate DietErrorPct,
    IReadOnlyList<WeekWrongMeals> DietWrongMeals,
    IReadOnlyList<DietDeviationEntry> DietDeviations,
    WorkoutMisses MissedWorkouts,
    CardioMisses MissedCardio,
    IReadOnlyList<ItemMisses> ItemsMissed,
    IReadOnlyList<ItemUse> ItemsUsed);
