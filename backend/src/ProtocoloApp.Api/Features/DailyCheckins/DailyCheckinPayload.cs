using FluentValidation;

namespace ProtocoloApp.Api.Features.DailyCheckins;

/// <summary>
/// The <c>daily_checkin</c> payload, as the front sends it in push and receives it in pull (snake_case JSON):
/// <code>
/// {
///   "date": "2026-01-31",        // required, yyyy-MM-dd; one live check-in per user and date
///   "sleep_quality": 4,          // morning part, integer 1–5
///   "bowel": "normal",           // morning part, "normal" | "loose" | "constipated"
///   "energy_wake": 3,            // morning part, integer 1–5
///   "weight_kg": 80.4,           // morning part (optional), kg 30–300, at most 2 decimals
///   "energy_day": 4,             // evening part, integer 1–5
///   "anxiety": 2,                // evening part, integer 1–5
///   "water_l": 2.5,              // evening part, liters 0–15, at most 2 decimals
///   "note": "...",               // evening part (optional), up to 2000 characters; "" clears the stored note
///   "cardio_done": true,         // from the Today cardio item (null = not answered)
///   "cardio_minutes": 30         // integer 0–300, only with cardio_done == true in the same payload
/// }
/// </code>
/// Only <c>date</c> is required; every other field is validated only when present. The handler merges field by field: a
/// null (or missing) field keeps the stored value, so the morning part saved on one device and the evening part on another
/// never erase each other. Unknown properties are ignored. In pull every field is written, null when not stored.
/// </summary>
public sealed record DailyCheckinPayload
{
    public DateOnly? Date { get; init; }

    public int? SleepQuality { get; init; }

    public string? Bowel { get; init; }

    public int? EnergyWake { get; init; }

    public int? EnergyDay { get; init; }

    public int? Anxiety { get; init; }

    public decimal? WaterL { get; init; }

    public decimal? WeightKg { get; init; }

    public string? Note { get; init; }

    public bool? CardioDone { get; init; }

    public int? CardioMinutes { get; init; }
}

/// <summary>Field limits of <see cref="DailyCheckinPayload"/>. Property names are the snake_case JSON names (error codes).</summary>
public sealed class DailyCheckinPayloadValidator : AbstractValidator<DailyCheckinPayload>
{
    public DailyCheckinPayloadValidator()
    {
        RuleFor(p => p.Date).NotNull().OverridePropertyName("date");
        // Null means "not in this payload" (the stored value is kept); FluentValidation's range rules pass on null.
        RuleFor(p => p.SleepQuality).InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("sleep_quality");
        RuleFor(p => p.Bowel).Must(BowelText.IsValid).When(p => p.Bowel is not null).OverridePropertyName("bowel");
        RuleFor(p => p.EnergyWake).InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("energy_wake");
        RuleFor(p => p.EnergyDay).InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("energy_day");
        RuleFor(p => p.Anxiety).InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("anxiety");
        RuleFor(p => p.WaterL).InclusiveBetween(0m, (decimal)DailyCheckin.MaxWaterL).PrecisionScale(4, 2, true).OverridePropertyName("water_l");
        RuleFor(p => p.WeightKg).InclusiveBetween((decimal)DailyCheckin.MinWeightKg, (decimal)DailyCheckin.MaxWeightKg).PrecisionScale(5, 2, true).OverridePropertyName("weight_kg");
        RuleFor(p => p.Note).MaximumLength(DailyCheckin.MaxNoteLength).OverridePropertyName("note");
        RuleFor(p => p.CardioMinutes).InclusiveBetween(0, DailyCheckin.MaxCardioMinutes).OverridePropertyName("cardio_minutes");
        RuleFor(p => p.CardioMinutes)
            .Must((p, minutes) => minutes is null || p.CardioDone == true)
            .OverridePropertyName("cardio_minutes");
    }
}
