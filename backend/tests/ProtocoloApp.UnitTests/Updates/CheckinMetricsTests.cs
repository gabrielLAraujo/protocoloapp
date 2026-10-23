using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.Updates.Metrics;

namespace ProtocoloApp.UnitTests.Updates;

public sealed class CheckinMetricsTests
{
    private static DailyCheckin Day(int day) => new() { Id = Guid.NewGuid(), Date = new DateOnly(2026, 10, day) };

    [Fact]
    public void No_checkins_gives_null_averages_and_empty_lists()
    {
        var result = CheckinMetrics.Compute([], 3.5m);

        Assert.Equal(new WeightChange(null, null, null), result.Weight);
        Assert.Equal(new WaterAverage(null, 3.5m, 0), result.WaterAvg);
        Assert.Equal(new ScoreAverage(null, 0), result.SleepAvg);
        Assert.Equal(new EnergyAverage(new ScoreAverage(null, 0), new ScoreAverage(null, 0)), result.EnergyAvg);
        Assert.Equal(new ScoreAverage(null, 0), result.AnxietyAvg);
        Assert.Equal(new ScoreAverage(null, 0), result.StressAvg);
        Assert.Equal(new ScoreAverage(null, 0), result.MoodAvg);
        Assert.Empty(result.CheckinNotes);
    }

    [Fact]
    public void Weight_is_first_and_last_of_the_period_by_date()
    {
        var a = Day(20);
        a.WeightKg = 80.4m;
        var b = Day(24);
        var c = Day(27);
        c.WeightKg = 79.15m;

        var result = CheckinMetrics.Compute([c, b, a], null);

        Assert.Equal(new WeightChange(new DatedWeight(a.Date, 80.4m), new DatedWeight(c.Date, 79.15m), -1.25m), result.Weight);
    }

    [Fact]
    public void Weight_of_a_single_day_has_zero_delta()
    {
        var a = Day(20);
        a.WeightKg = 75m;

        var result = CheckinMetrics.Compute([a, Day(21)], null);

        Assert.Equal(0m, result.Weight.DeltaKg);
        Assert.Equal(result.Weight.Start, result.Weight.End);
    }

    [Fact]
    public void Averages_count_only_days_with_a_value()
    {
        var a = Day(20);
        a.SleepQuality = 4;
        a.EnergyWake = 3;
        a.WaterL = 3m;
        a.Anxiety = 1;
        var b = Day(21);
        b.SleepQuality = 5;
        b.EnergyDay = 2;
        b.WaterL = 2.5m;
        var c = Day(22);
        c.SleepQuality = 5;
        c.WaterL = 2.25m;

        var result = CheckinMetrics.Compute([a, b, c, Day(23)], 3m);

        Assert.Equal(new ScoreAverage(4.7m, 3), result.SleepAvg);
        Assert.Equal(new EnergyAverage(new ScoreAverage(3m, 1), new ScoreAverage(2m, 1)), result.EnergyAvg);
        Assert.Equal(new ScoreAverage(1m, 1), result.AnxietyAvg);
        Assert.Equal(new WaterAverage(2.58m, 3m, 3), result.WaterAvg);
    }

    [Fact]
    public void Stress_and_mood_average_the_days_with_a_value_and_a_zero_stress_counts()
    {
        var a = Day(20);
        a.Stress = 0;
        a.Mood = 4;
        var b = Day(21);
        b.Stress = 7;
        var c = Day(22);
        c.Stress = 2;
        c.Mood = 3;
        var deleted = Day(23);
        deleted.Stress = 10;
        deleted.Mood = 1;
        deleted.DeletedAt = DateTimeOffset.UnixEpoch;

        var result = CheckinMetrics.Compute([a, b, c, deleted, Day(24)], null);

        Assert.Equal(new ScoreAverage(3m, 3), result.StressAvg);
        Assert.Equal(new ScoreAverage(3.5m, 2), result.MoodAvg);
    }

    [Fact]
    public void Notes_skip_blank_ones_and_come_by_date()
    {
        var a = Day(22);
        a.Note = "  Semana de exemplo tranquila. ";
        var b = Day(21);
        b.Note = "   ";
        var c = Day(20);
        c.Note = "Nota fictícia";

        var result = CheckinMetrics.Compute([a, b, c], null);

        Assert.Equal([new CheckinNote(c.Date, "Nota fictícia"), new CheckinNote(a.Date, "Semana de exemplo tranquila.")], result.CheckinNotes);
    }

    [Fact]
    public void Deleted_checkins_are_ignored()
    {
        var a = Day(20);
        a.WeightKg = 70m;
        a.Note = "Apagada";
        a.DeletedAt = DateTimeOffset.UnixEpoch;

        var result = CheckinMetrics.Compute([a], null);

        Assert.Null(result.Weight.Start);
        Assert.Empty(result.CheckinNotes);
    }
}
