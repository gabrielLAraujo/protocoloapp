using System.Text.Json.Serialization;
using FluentValidation;

namespace ProtocoloApp.Api.Features.DailyCheckins;

/// <summary>
/// The <c>daily_checkin</c> payload, as the front sends it in push and receives it in pull (snake_case JSON):
/// <code>
/// {
///   "date": "2026-01-31",        // required, yyyy-MM-dd; one live check-in per user and date
///   "parts": ["morning"],        // optional: the parts this change writes; missing = all three (full overwrite)
///   "sleep_quality": 4,          // morning, integer 1–5
///   "energy_wake": 3,            // morning, integer 1–5
///   "bowel": "normal",           // morning, "normal" | "loose" | "constipated"
///   "weight_kg": 80.4,           // morning (optional), kg 30–300, at most 2 decimals
///   "energy_day": 4,             // evening, integer 1–5
///   "anxiety": 2,                // evening, integer 1–5
///   "water_l": 2.5,              // evening, liters 0–15, at most 2 decimals
///   "note": "...",               // evening (optional), up to 2000 characters
///   "stress": 3,                 // evening (optional), integer 0–10
///   "mood": 4,                   // evening (optional), integer 1–5
///   "cardio_done": true,         // cardio (null = not answered)
///   "cardio_minutes": 30         // cardio, integer 0–300, only with cardio_done == true
/// }
/// </code>
/// Each listed part replaces all of its fields, null included (null clears); parts not listed keep their stored values and
/// their fields in the payload are ignored. A listed morning part is either complete (its required fields non-null; weight
/// stays optional) or entirely null (clears the part). A listed evening part is complete (energy_day, anxiety and water_l;
/// note, stress and mood optional), or carries no scores: water_l and/or note alone (the water logged during the day), or nothing (clears
/// the part). energy_day and anxiety come together. Without <c>parts</c> the payload must carry
/// some data (a date-only payload is <c>invalid_payload:parts</c>). Each part has its own last-write-wins clock (see
/// <see cref="DailyCheckinSyncHandler"/>). Unknown properties are ignored. Pull writes every field (null when not stored)
/// and no <c>parts</c>.
/// </summary>
public sealed record DailyCheckinPayload
{
    public DateOnly? Date { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? Parts { get; init; }

    public int? SleepQuality { get; init; }

    public string? Bowel { get; init; }

    public int? EnergyWake { get; init; }

    public int? EnergyDay { get; init; }

    public int? Anxiety { get; init; }

    public decimal? WaterL { get; init; }

    public int? Stress { get; init; }

    public int? Mood { get; init; }

    public decimal? WeightKg { get; init; }

    public string? Note { get; init; }

    public bool? CardioDone { get; init; }

    public int? CardioMinutes { get; init; }

    /// <summary>Whether this change writes <paramref name="part"/> (no <c>parts</c> = every part).</summary>
    public bool Writes(string part) => Parts is null || Parts.Contains(part, StringComparer.Ordinal);

    internal bool HasMorningData => SleepQuality is not null || EnergyWake is not null || Bowel is not null || WeightKg is not null;

    internal bool HasEveningData =>
        EnergyDay is not null || Anxiety is not null || WaterL is not null || Note is not null || Stress is not null || Mood is not null;

    internal bool HasCardioData => CardioDone is not null || CardioMinutes is not null;
}

/// <summary>Field limits of <see cref="DailyCheckinPayload"/>. Property names are the snake_case JSON names (error codes).</summary>
public sealed class DailyCheckinPayloadValidator : AbstractValidator<DailyCheckinPayload>
{
    public DailyCheckinPayloadValidator()
    {
        RuleFor(p => p.Date).NotNull().OverridePropertyName("date");

        // A list of known parts, not empty; without a list the payload must carry something.
        RuleFor(p => p.Parts)
            .Must(parts => parts is null || (parts.Count > 0 && parts.All(CheckinPart.IsValid)))
            .OverridePropertyName("parts");
        RuleFor(p => p)
            .Must(p => p.Parts is not null || p.HasMorningData || p.HasEveningData || p.HasCardioData)
            .OverridePropertyName("parts");

        // Ranges apply to any field present (FluentValidation's range rules pass on null).
        RuleFor(p => p.SleepQuality).InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("sleep_quality");
        RuleFor(p => p.Bowel).Must(BowelText.IsValid).When(p => p.Bowel is not null).OverridePropertyName("bowel");
        RuleFor(p => p.EnergyWake).InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("energy_wake");
        RuleFor(p => p.EnergyDay).InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("energy_day");
        RuleFor(p => p.Anxiety).InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("anxiety");
        RuleFor(p => p.Stress).InclusiveBetween(DailyCheckin.MinStress, DailyCheckin.MaxStress).OverridePropertyName("stress");
        RuleFor(p => p.Mood).InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("mood");
        RuleFor(p => p.WaterL).InclusiveBetween(0m, (decimal)DailyCheckin.MaxWaterL).PrecisionScale(4, 2, true).OverridePropertyName("water_l");
        RuleFor(p => p.WeightKg).InclusiveBetween((decimal)DailyCheckin.MinWeightKg, (decimal)DailyCheckin.MaxWeightKg).PrecisionScale(5, 2, true).OverridePropertyName("weight_kg");
        RuleFor(p => p.Note).MaximumLength(DailyCheckin.MaxNoteLength).OverridePropertyName("note");
        RuleFor(p => p.CardioMinutes).InclusiveBetween(0, DailyCheckin.MaxCardioMinutes).OverridePropertyName("cardio_minutes");
        RuleFor(p => p.CardioMinutes)
            .Must((p, minutes) => minutes is null || p.CardioDone == true)
            .OverridePropertyName("cardio_minutes");

        // A written morning with any data must be complete; all null clears it.
        When(p => p.Writes(CheckinPart.Morning) && p.HasMorningData, () =>
        {
            RuleFor(p => p.SleepQuality).NotNull().OverridePropertyName("sleep_quality");
            RuleFor(p => p.EnergyWake).NotNull().OverridePropertyName("energy_wake");
            RuleFor(p => p.Bowel).NotNull().OverridePropertyName("bowel");
        });
        // The evening may also carry water (and a note) alone: the water logged on Hoje during the day, before the evening
        // check-in. Once a score is there, the part is the full check-in: both scores and the water.
        When(p => p.Writes(CheckinPart.Evening) && (p.EnergyDay is not null || p.Anxiety is not null), () =>
        {
            RuleFor(p => p.EnergyDay).NotNull().OverridePropertyName("energy_day");
            RuleFor(p => p.Anxiety).NotNull().OverridePropertyName("anxiety");
            RuleFor(p => p.WaterL).NotNull().OverridePropertyName("water_l");
        });
    }
}
