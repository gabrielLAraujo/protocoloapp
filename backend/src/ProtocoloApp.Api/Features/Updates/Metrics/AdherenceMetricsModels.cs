using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.DietDeviations;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;

namespace ProtocoloApp.Api.Features.Updates.Metrics;

/// <summary>
/// What the adherence metrics read. <c>Days</c> are the cycle days (<c>period_start</c>..<c>min(period_end, today)</c>) with
/// their plan; the first one anchors the weeks. <c>MealLabels</c> maps a protocol meal key to its label.
/// </summary>
public sealed record AdherenceInput(
    IReadOnlyList<(DateOnly Date, DayPlan Plan)> Days,
    DateOnly Today,
    IReadOnlyList<AdherenceLog> Logs,
    IReadOnlyList<DietDeviation> Deviations,
    IReadOnlyList<DailyCheckin> Checkins,
    ISet<DateOnly> WorkedOutDates,
    CardioPlanDto? Cardio,
    IReadOnlyDictionary<string, string> MealLabels);

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

public sealed record WorkoutMisses(int Planned, int Done, IReadOnlyList<DateOnly> MissedDates);

public sealed record CardioMisses(int Planned, int Done);

public sealed record ItemMisses(string Key, string Name, int Missed, IReadOnlyList<ReasonCount> Reasons);

public sealed record AdherenceResult(
    DietErrorRate DietErrorPct,
    IReadOnlyList<WeekWrongMeals> DietWrongMeals,
    IReadOnlyList<DietDeviationEntry> DietDeviations,
    WorkoutMisses MissedWorkouts,
    CardioMisses MissedCardio,
    IReadOnlyList<ItemMisses> ItemsMissed);
