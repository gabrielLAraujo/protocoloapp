using FluentValidation;

namespace ProtocoloApp.Api.Features.DailyCheckins;

/// <summary>
/// The <c>daily_checkin</c> payload, as the front sends it in push and receives it in pull (snake_case JSON):
/// <code>
/// {
///   "date": "2026-01-31",        // required, yyyy-MM-dd; one live check-in per user and date
///   "sleep_quality": 4,          // required, integer 1–5
///   "bowel": "normal",           // required, "normal" | "loose" | "constipated"
///   "energy_wake": 3,            // required, integer 1–5
///   "energy_day": 4,             // required, integer 1–5
///   "anxiety": 2,                // required, integer 1–5
///   "water_l": 2.5,              // required, liters 0–15, at most 2 decimals
///   "weight_kg": 80.4,           // optional (null), kg 30–300, at most 2 decimals
///   "note": "...",               // optional (null), up to 2000 characters
///   "cardio_done": true,         // optional (null = not answered)
///   "cardio_minutes": 30         // optional (null), integer 0–300, only with cardio_done == true
/// }
/// </code>
/// Last write wins over the whole payload: a check-in sent without the cardio fields (an older client) stores them as null.
/// Every property is nullable here so that a missing field is reported as <c>invalid_payload:&lt;field&gt;</c> by
/// <see cref="DailyCheckinPayloadValidator"/> instead of silently becoming 0. Unknown properties are ignored.
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
        RuleFor(p => p.SleepQuality).NotNull().InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("sleep_quality");
        RuleFor(p => p.Bowel).Must(BowelText.IsValid).OverridePropertyName("bowel");
        RuleFor(p => p.EnergyWake).NotNull().InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("energy_wake");
        RuleFor(p => p.EnergyDay).NotNull().InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("energy_day");
        RuleFor(p => p.Anxiety).NotNull().InclusiveBetween(DailyCheckin.MinScore, DailyCheckin.MaxScore).OverridePropertyName("anxiety");
        RuleFor(p => p.WaterL).NotNull().InclusiveBetween(0m, (decimal)DailyCheckin.MaxWaterL).PrecisionScale(4, 2, true).OverridePropertyName("water_l");
        RuleFor(p => p.WeightKg).InclusiveBetween((decimal)DailyCheckin.MinWeightKg, (decimal)DailyCheckin.MaxWeightKg).PrecisionScale(5, 2, true).OverridePropertyName("weight_kg");
        RuleFor(p => p.Note).MaximumLength(DailyCheckin.MaxNoteLength).OverridePropertyName("note");
        RuleFor(p => p.CardioMinutes).InclusiveBetween(0, DailyCheckin.MaxCardioMinutes).OverridePropertyName("cardio_minutes");
        RuleFor(p => p.CardioMinutes)
            .Must((p, minutes) => minutes is null || p.CardioDone == true)
            .OverridePropertyName("cardio_minutes");
    }
}
