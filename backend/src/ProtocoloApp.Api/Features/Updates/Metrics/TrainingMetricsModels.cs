using ProtocoloApp.Api.Features.Plans;

namespace ProtocoloApp.Api.Features.Updates.Metrics;

/// <summary>e1RM change of one exercise between its first and last session of the cycle (kg, two decimals).</summary>
public sealed record StrengthTrend(Guid ExerciseId, string Name, decimal FirstE1rm, decimal LastE1rm, decimal Delta, int Sessions);

/// <summary>Per muscle group: the 2 exercises that improved the most and the (up to) 2 that lost the most.</summary>
public sealed record GroupStrength(MuscleGroup Group, IReadOnlyList<StrengthTrend> Best, IReadOnlyList<StrengthTrend> Worst);

/// <summary>Values of <see cref="TrainingChange.Kind"/>.</summary>
public static class TrainingChangeKind
{
    public const string PlanActivated = "plan_activated";
    public const string Swapped = "swapped";
    public const string Skipped = "skipped";
}

/// <summary>A change to the training in the cycle: a workout plan activated, or a planned exercise swapped or skipped in a session.</summary>
public sealed record TrainingChange(DateOnly Date, string Kind, string? ExerciseName, string? ReplacementName);

public sealed record DatedWeight(DateOnly Date, decimal Kg);

/// <summary>First and last weight of the cycle; <see cref="DeltaKg"/> is null when no day has a weight.</summary>
public sealed record WeightChange(DatedWeight? Start, DatedWeight? End, decimal? DeltaKg);

/// <summary>Average liters (two decimals) over the <see cref="Days"/> days with a value; null when there are none.</summary>
public sealed record WaterAverage(decimal? AvgL, decimal? TargetL, int Days);

/// <summary>Average score (one decimal: 1–5, or 0–10 for stress) over the <see cref="Days"/> days with a value; null when there are none.</summary>
public sealed record ScoreAverage(decimal? Avg, int Days);

public sealed record EnergyAverage(ScoreAverage Wake, ScoreAverage Day);

public sealed record CheckinNote(DateOnly Date, string Note);

public sealed record CheckinResult(
    WeightChange Weight,
    WaterAverage WaterAvg,
    ScoreAverage SleepAvg,
    EnergyAverage EnergyAvg,
    ScoreAverage AnxietyAvg,
    ScoreAverage StressAvg,
    ScoreAverage MoodAvg,
    IReadOnlyList<CheckinNote> CheckinNotes);
