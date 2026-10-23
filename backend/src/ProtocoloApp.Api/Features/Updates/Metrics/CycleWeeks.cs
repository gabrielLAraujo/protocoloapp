namespace ProtocoloApp.Api.Features.Updates.Metrics;

/// <summary>The weeks of an update cycle: blocks of 7 days from the first day (Semana 1, 2…); the last one may be short.</summary>
public static class CycleWeeks
{
    public const int DaysPerWeek = 7;

    /// <summary>The weeks covering <paramref name="from"/>..<paramref name="to"/> (both inclusive); empty when <c>from &gt; to</c>.</summary>
    public static IReadOnlyList<(int Week, DateOnly From, DateOnly To)> Split(DateOnly from, DateOnly to)
    {
        var weeks = new List<(int Week, DateOnly From, DateOnly To)>();
        for (var (week, start) = (1, from); start <= to; week++, start = start.AddDays(DaysPerWeek))
        {
            var end = start.AddDays(DaysPerWeek - 1);
            weeks.Add((week, start, end < to ? end : to));
        }

        return weeks;
    }

    /// <summary>The week number (1-based) of <paramref name="date"/> in a cycle starting on <paramref name="from"/>.</summary>
    public static int WeekOf(DateOnly from, DateOnly date) => ((date.DayNumber - from.DayNumber) / DaysPerWeek) + 1;
}
