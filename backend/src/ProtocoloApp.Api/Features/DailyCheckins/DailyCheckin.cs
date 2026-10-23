using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.DailyCheckins;

/// <summary>The daily subjective check-in (spec 4.3): one live row per user and date.</summary>
public sealed class DailyCheckin : ISyncEntity
{
    public const int MinScore = 1;
    public const int MaxScore = 5;
    public const int MinStress = 0;
    public const int MaxStress = 10;
    public const int MaxWaterL = 15;
    public const int MinWeightKg = 30;
    public const int MaxWeightKg = 300;
    public const int MaxNoteLength = 2000;
    public const int MaxCardioMinutes = 300;

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public DateOnly Date { get; set; }

    // Last-write-wins per part (see DailyCheckinSyncHandler): the client_updated_at of the change that last wrote each part.
    // Null = the part was never written. ClientUpdatedAt (the row clock used by pull) is the latest of the three.

    /// <summary>Clock of the morning part (sleep_quality, energy_wake, bowel, weight_kg).</summary>
    public DateTimeOffset? MorningClientUpdatedAt { get; set; }

    /// <summary>Clock of the evening part (energy_day, anxiety, water_l, note, stress, mood).</summary>
    public DateTimeOffset? EveningClientUpdatedAt { get; set; }

    /// <summary>Clock of the cardio part (cardio_done, cardio_minutes).</summary>
    public DateTimeOffset? CardioClientUpdatedAt { get; set; }

    // The check-in is saved in two parts (morning: sleep, energy on waking, bowel; evening: energy during the day, anxiety,
    // water), so each part field is null until its part is saved. A row created only by the cardio item has all of them null.

    /// <summary>1–5. Morning part.</summary>
    public int? SleepQuality { get; set; }

    /// <summary>Morning part.</summary>
    public Bowel? Bowel { get; set; }

    /// <summary>1–5. Morning part.</summary>
    public int? EnergyWake { get; set; }

    /// <summary>1–5. Evening part.</summary>
    public int? EnergyDay { get; set; }

    /// <summary>1–5. Evening part.</summary>
    public int? Anxiety { get; set; }

    /// <summary>Stressors that showed up in the day, 0–10. Evening part, optional (not needed for a complete evening).</summary>
    public int? Stress { get; set; }

    /// <summary>Emotional state, 1–5. Evening part, optional (not needed for a complete evening).</summary>
    public int? Mood { get; set; }

    /// <summary>Liters, 0–15, two decimals. Evening part.</summary>
    public decimal? WaterL { get; set; }

    /// <summary>Kilograms, 30–300, two decimals. Optional.</summary>
    public decimal? WeightKg { get; set; }

    /// <summary>Up to 2000 characters. Optional.</summary>
    public string? Note { get; set; }

    /// <summary>Whether cardio was done. Null = not answered (also every row written before this field existed).</summary>
    public bool? CardioDone { get; set; }

    /// <summary>Minutes of cardio, 0–300. Only with <see cref="CardioDone"/> true.</summary>
    public int? CardioMinutes { get; set; }
}

/// <summary>The parts of a check-in, as listed in the payload's <c>parts</c>.</summary>
public static class CheckinPart
{
    public const string Morning = "morning";
    public const string Evening = "evening";
    public const string Cardio = "cardio";

    public static IReadOnlyList<string> All { get; } = [Morning, Evening, Cardio];

    public static bool IsValid(string? part) => part is Morning or Evening or Cardio;
}

public enum Bowel
{
    Normal,
    Loose,
    Constipated,
}

/// <summary>The lowercase text of <see cref="Bowel"/>, used in the payload and in the database column.</summary>
public static class BowelText
{
    public const string Normal = "normal";
    public const string Loose = "loose";
    public const string Constipated = "constipated";

    public static bool IsValid(string? text) => text is Normal or Loose or Constipated;

    public static string ToText(Bowel value) => value switch
    {
        Bowel.Normal => Normal,
        Bowel.Loose => Loose,
        Bowel.Constipated => Constipated,
        _ => throw new ArgumentOutOfRangeException(nameof(value), value, "Unknown bowel value."),
    };

    /// <exception cref="FormatException">Not one of the three values.</exception>
    public static Bowel Parse(string text) => text switch
    {
        Normal => Bowel.Normal,
        Loose => Bowel.Loose,
        Constipated => Bowel.Constipated,
        _ => throw new FormatException($"Unknown bowel value '{text}'."),
    };
}
