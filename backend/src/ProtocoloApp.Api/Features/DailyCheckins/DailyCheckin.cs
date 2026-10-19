using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.DailyCheckins;

/// <summary>The daily subjective check-in (spec 4.3): one live row per user and date.</summary>
public sealed class DailyCheckin : ISyncEntity
{
    public const int MinScore = 1;
    public const int MaxScore = 5;
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

    /// <summary>1–5.</summary>
    public int SleepQuality { get; set; }

    public Bowel Bowel { get; set; }

    /// <summary>1–5.</summary>
    public int EnergyWake { get; set; }

    /// <summary>1–5.</summary>
    public int EnergyDay { get; set; }

    /// <summary>1–5.</summary>
    public int Anxiety { get; set; }

    /// <summary>Liters, 0–15, two decimals.</summary>
    public decimal WaterL { get; set; }

    /// <summary>Kilograms, 30–300, two decimals. Optional.</summary>
    public decimal? WeightKg { get; set; }

    /// <summary>Up to 2000 characters. Optional.</summary>
    public string? Note { get; set; }

    /// <summary>Whether cardio was done. Null = not answered (also every row written before this field existed).</summary>
    public bool? CardioDone { get; set; }

    /// <summary>Minutes of cardio, 0–300. Only with <see cref="CardioDone"/> true.</summary>
    public int? CardioMinutes { get; set; }
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
