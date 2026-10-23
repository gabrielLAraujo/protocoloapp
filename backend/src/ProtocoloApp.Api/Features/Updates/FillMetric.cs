namespace ProtocoloApp.Api.Features.Updates;

/// <summary>
/// The metrics a questionnaire question can be filled from (<c>fill</c>). A closed list, the same as the front's
/// <c>FILL_METRICS</c>; the server computes them over the update cycle.
/// </summary>
public static class FillMetric
{
    public const string DietErrorPct = "diet_error_pct";
    public const string DietWrongMeals = "diet_wrong_meals";
    public const string DietDeviations = "diet_deviations";
    public const string MissedWorkouts = "missed_workouts";
    public const string MissedCardio = "missed_cardio";
    public const string ItemsMissed = "items_missed";
    public const string ItemsUsed = "items_used";
    public const string StrengthChanges = "strength_changes";
    public const string TrainingChanges = "training_changes";
    public const string Weight = "weight";
    public const string WaterAvg = "water_avg";
    public const string SleepAvg = "sleep_avg";
    public const string EnergyAvg = "energy_avg";
    public const string AnxietyAvg = "anxiety_avg";
    public const string StressAvg = "stress_avg";
    public const string MoodAvg = "mood_avg";
    public const string CheckinNotes = "checkin_notes";

    public static IReadOnlyList<string> All { get; } =
    [
        DietErrorPct,
        DietWrongMeals,
        DietDeviations,
        MissedWorkouts,
        MissedCardio,
        ItemsMissed,
        ItemsUsed,
        StrengthChanges,
        TrainingChanges,
        Weight,
        WaterAvg,
        SleepAvg,
        EnergyAvg,
        AnxietyAvg,
        StressAvg,
        MoodAvg,
        CheckinNotes,
    ];

    /// <summary>The metrics that accept <c>fillOptions.week</c> (one week of the cycle).</summary>
    public static IReadOnlyList<string> WeekMetrics { get; } = [DietErrorPct, DietWrongMeals, DietDeviations, MissedWorkouts, MissedCardio];

    /// <summary>The metrics that accept <c>fillOptions.categories</c> (protocol item categories).</summary>
    public static IReadOnlyList<string> CategoryMetrics { get; } = [ItemsMissed, ItemsUsed];

    /// <summary>The metrics that accept <c>fillOptions.groups</c> (muscle groups).</summary>
    public static IReadOnlyList<string> GroupMetrics { get; } = [StrengthChanges];

    public static bool IsKnown(string? metric) => metric is not null && All.Contains(metric, StringComparer.Ordinal);
}
