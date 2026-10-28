using ProtocoloApp.Api.Features.Workouts;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>
/// Turns the sets of one Hevy exercise into <see cref="SetLog"/> rows (spec "Hevy", section 3):
/// <list type="bullet">
/// <item><c>normal</c>, <c>failure</c> (and any unknown type) → <c>normal</c>; <c>warmup</c> → <c>warmup</c>;</item>
/// <item><c>dropset</c> → <c>drop</c>, child of the last kept <c>normal</c> set of the exercise and with its <c>set_index</c>;
/// without one it is a <c>normal</c> set;</item>
/// <item><c>weight_kg</c> null → 0 (body weight), rounded to 2 decimals; <c>rpe</c> outside 1..10 or not a multiple of 0.5 → null;</item>
/// <item>skipped (and counted): <c>reps</c> null (a set of time or distance only), reps outside 0..200, weight outside
/// 0..1000, or a <c>set_index</c> above <see cref="SetLog.MaxSetIndex"/>.</item>
/// </list>
/// Sets follow Hevy's <c>index</c>; the main ones (not drops) get consecutive <c>set_index</c> values from
/// <c>firstSetIndex</c>. <c>CompletedAt</c> = <c>fallbackAt</c> + 1 s per kept set, so the order survives on the device.
/// </summary>
public static class HevySetMapper
{
    public static (IReadOnlyList<SetLog> Sets, int Skipped) Map(
        HevyExercise ex,
        Guid sessionId,
        Guid exerciseId,
        string? plannedKey,
        Guid userId,
        DateTimeOffset fallbackAt,
        int firstSetIndex = 0)
    {
        ArgumentNullException.ThrowIfNull(ex);

        var sets = new List<SetLog>();
        var skipped = 0;
        var nextIndex = firstSetIndex;
        SetLog? lastNormal = null;
        var templateId = ex.TemplateId.Length is > 0 and <= WorkoutSession.MaxExternalIdLength ? ex.TemplateId : null;

        foreach (var set in ex.Sets.OrderBy(s => s.Index))
        {
            if (!IsImportable(set))
            {
                skipped++;
                continue;
            }

            var kind = set.Type switch
            {
                "warmup" => SetKind.Warmup,
                "dropset" when lastNormal is not null => SetKind.Drop,
                _ => SetKind.Normal,
            };
            var index = kind == SetKind.Drop ? lastNormal!.SetIndex : nextIndex;
            if (index > SetLog.MaxSetIndex)
            {
                skipped++;
                continue;
            }

            if (kind != SetKind.Drop)
                nextIndex++;

            var row = new SetLog
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                SessionId = sessionId,
                ExerciseId = exerciseId,
                PlannedExerciseKey = plannedKey,
                SetIndex = index,
                WeightKg = Math.Round(set.WeightKg ?? 0m, 2, MidpointRounding.AwayFromZero),
                Reps = set.Reps!.Value,
                Kind = kind,
                ParentSetId = kind == SetKind.Drop ? lastNormal!.Id : null,
                CompletedAt = fallbackAt.AddSeconds(sets.Count + 1),
                Rpe = ValidRpe(set.Rpe),
                HevyTemplateId = templateId,
            };
            sets.Add(row);
            if (kind == SetKind.Normal)
                lastNormal = row;
        }

        return (sets, skipped);
    }

    /// <summary>Whether at least one set of the exercise would be kept (an exercise of time or distance only has none).</summary>
    public static bool HasImportableSet(HevyExercise ex)
    {
        ArgumentNullException.ThrowIfNull(ex);
        return ex.Sets.Any(IsImportable);
    }

    /// <summary>Null unless 1 &lt;= rpe &lt;= 10 in steps of 0.5.</summary>
    public static decimal? ValidRpe(decimal? rpe) =>
        rpe is { } value && value >= SetLog.MinRpe && value <= SetLog.MaxRpe && decimal.Remainder(value * 2, 1) == 0 ? value : null;

    private static bool IsImportable(HevySet set) =>
        set.Reps is { } reps && reps >= 0 && reps <= SetLog.MaxReps
        && (set.WeightKg ?? 0m) >= 0m && (set.WeightKg ?? 0m) <= SetLog.MaxWeightKg;
}
