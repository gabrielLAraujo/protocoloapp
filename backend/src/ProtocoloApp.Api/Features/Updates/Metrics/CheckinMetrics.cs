using ProtocoloApp.Api.Features.DailyCheckins;

namespace ProtocoloApp.Api.Features.Updates.Metrics;

/// <summary>Check-in metrics of an update cycle (<c>weight</c>, <c>water_avg</c>, <c>sleep_avg</c>, <c>energy_avg</c>, <c>anxiety_avg</c>, <c>checkin_notes</c>). Pure: the caller loads the check-ins of the cycle.</summary>
public static class CheckinMetrics
{
    /// <summary>
    /// Weight = first and last <c>WeightKg</c> of the period by date; averages count only the days with a value (scores
    /// with one decimal, liters with two); notes that are not blank, trimmed, by date. Deleted rows are ignored.
    /// </summary>
    public static CheckinResult Compute(IReadOnlyList<DailyCheckin> checkins, decimal? waterTargetL)
    {
        var live = checkins.Where(c => c.DeletedAt is null).OrderBy(c => c.Date).ToList();

        var weighed = live.Where(c => c.WeightKg is not null).ToList();
        var weight = weighed.Count == 0
            ? new WeightChange(null, null, null)
            : new WeightChange(
                new DatedWeight(weighed[0].Date, Round(weighed[0].WeightKg!.Value, 2)),
                new DatedWeight(weighed[^1].Date, Round(weighed[^1].WeightKg!.Value, 2)),
                Round(weighed[^1].WeightKg!.Value - weighed[0].WeightKg!.Value, 2));

        var water = live.Where(c => c.WaterL is not null).Select(c => c.WaterL!.Value).ToList();
        var waterAvg = new WaterAverage(water.Count == 0 ? null : Round(water.Average(), 2), waterTargetL, water.Count);

        var notes = live
            .Where(c => !string.IsNullOrWhiteSpace(c.Note))
            .Select(c => new CheckinNote(c.Date, c.Note!.Trim()))
            .ToList();

        return new CheckinResult(
            weight,
            waterAvg,
            Score(live.Select(c => c.SleepQuality)),
            new EnergyAverage(Score(live.Select(c => c.EnergyWake)), Score(live.Select(c => c.EnergyDay))),
            Score(live.Select(c => c.Anxiety)),
            notes);
    }

    private static ScoreAverage Score(IEnumerable<int?> values)
    {
        var present = values.Where(v => v is not null).Select(v => (decimal)v!.Value).ToList();
        return new ScoreAverage(present.Count == 0 ? null : Round(present.Average(), 1), present.Count);
    }

    private static decimal Round(decimal value, int decimals) => Math.Round(value, decimals, MidpointRounding.AwayFromZero);
}
