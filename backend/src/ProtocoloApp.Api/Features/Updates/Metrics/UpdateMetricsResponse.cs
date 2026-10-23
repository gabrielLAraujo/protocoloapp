namespace ProtocoloApp.Api.Features.Updates.Metrics;

/// <summary>
/// The fill metrics of an update cycle over <see cref="From"/>..<see cref="To"/> (<c>period_start</c>..<c>min(period_end, today)</c>,
/// local dates). Computed on demand; the device keeps the last one for offline use.
/// </summary>
public sealed record UpdateMetricsResponse(
    Guid CycleId,
    DateOnly From,
    DateOnly To,
    DateTimeOffset ComputedAt,
    DietErrorRate DietErrorPct,
    IReadOnlyList<WeekWrongMeals> DietWrongMeals,
    IReadOnlyList<DietDeviationEntry> DietDeviations,
    WorkoutMisses MissedWorkouts,
    CardioMisses MissedCardio,
    IReadOnlyList<ItemMisses> ItemsMissed,
    IReadOnlyList<GroupStrength> StrengthChanges,
    IReadOnlyList<TrainingChange> TrainingChanges,
    WeightChange Weight,
    WaterAverage WaterAvg,
    ScoreAverage SleepAvg,
    EnergyAverage EnergyAvg,
    ScoreAverage AnxietyAvg,
    ScoreAverage StressAvg,
    ScoreAverage MoodAvg,
    IReadOnlyList<CheckinNote> CheckinNotes);
