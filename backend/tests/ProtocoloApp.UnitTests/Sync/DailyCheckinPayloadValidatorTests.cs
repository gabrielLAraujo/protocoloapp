using System.Globalization;
using System.Text.Json;
using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.Sync;

namespace ProtocoloApp.UnitTests.Sync;

public sealed class DailyCheckinPayloadValidatorTests
{
    private static readonly DailyCheckinPayloadValidator Validator = new();

    private static readonly DailyCheckinPayload Valid = new()
    {
        Date = new DateOnly(2026, 2, 3),
        SleepQuality = 3,
        Bowel = "normal",
        EnergyWake = 3,
        EnergyDay = 3,
        Anxiety = 3,
        WaterL = 2.5m,
        WeightKg = 80m,
        Note = "Exemplo.",
    };

    private static List<string> Errors(DailyCheckinPayload payload) =>
        Validator.Validate(payload).Errors.Select(e => e.PropertyName).Distinct().ToList();

    private static DailyCheckinPayload WithScore(string field, int value) => field switch
    {
        "sleep_quality" => Valid with { SleepQuality = value },
        "energy_wake" => Valid with { EnergyWake = value },
        "energy_day" => Valid with { EnergyDay = value },
        "anxiety" => Valid with { Anxiety = value },
        _ => throw new ArgumentOutOfRangeException(nameof(field)),
    };

    private static decimal Dec(string value) => decimal.Parse(value, CultureInfo.InvariantCulture);

    [Fact]
    public void Valid_payload_passes()
    {
        Assert.Empty(Errors(Valid));
    }

    [Fact]
    public void Optional_fields_may_be_null()
    {
        Assert.Empty(Errors(Valid with { WeightKg = null, Note = null }));
    }

    [Theory]
    [InlineData("sleep_quality")]
    [InlineData("energy_wake")]
    [InlineData("energy_day")]
    [InlineData("anxiety")]
    public void Scores_accept_1_to_5(string field)
    {
        Assert.Empty(Errors(WithScore(field, 1)));
        Assert.Empty(Errors(WithScore(field, 5)));
        Assert.Equal(new[] { field }, Errors(WithScore(field, 0)));
        Assert.Equal(new[] { field }, Errors(WithScore(field, 6)));
    }

    private static readonly DateOnly Date = new(2026, 2, 3);

    [Fact]
    public void Stress_accepts_0_to_10()
    {
        Assert.Empty(Errors(Valid with { Stress = 0 }));
        Assert.Empty(Errors(Valid with { Stress = 10 }));
        Assert.Equal(new[] { "stress" }, Errors(Valid with { Stress = -1 }));
        Assert.Equal(new[] { "stress" }, Errors(Valid with { Stress = 11 }));
    }

    [Fact]
    public void Mood_accepts_1_to_5()
    {
        Assert.Empty(Errors(Valid with { Mood = 1 }));
        Assert.Empty(Errors(Valid with { Mood = 5 }));
        Assert.Equal(new[] { "mood" }, Errors(Valid with { Mood = 0 }));
        Assert.Equal(new[] { "mood" }, Errors(Valid with { Mood = 6 }));
    }

    [Fact]
    public void Stress_and_mood_are_optional_in_a_complete_evening()
    {
        var evening = new DailyCheckinPayload { Date = Date, Parts = ["evening"], EnergyDay = 4, Anxiety = 2, WaterL = 3m };

        Assert.Empty(Errors(evening));
        Assert.Empty(Errors(evening with { Stress = 3, Mood = 4 }));
        Assert.Empty(Errors(evening with { Mood = 4 }));
    }

    [Fact]
    public void Stress_alone_counts_as_data_without_parts()
    {
        Assert.Empty(Errors(new DailyCheckinPayload { Date = Date, Stress = 0 }));
        Assert.Empty(Errors(new DailyCheckinPayload { Date = Date, Mood = 3 }));
    }

    [Fact]
    public void Read_parses_stress_and_mood_and_older_payloads_leave_them_null()
    {
        var withMeters = JsonDocument.Parse("""{"date":"2026-02-03","parts":["evening"],"energy_day":3,"anxiety":1,"water_l":2,"stress":7,"mood":2}""").RootElement;
        var older = JsonDocument.Parse("""{"date":"2026-02-03","parts":["evening"],"energy_day":3,"anxiety":1,"water_l":2}""").RootElement;

        var payload = SyncPayload.Read(withMeters, Validator, out var errors);
        var old = SyncPayload.Read(older, Validator, out var oldErrors);

        Assert.Empty(errors);
        Assert.Equal(7, payload!.Stress);
        Assert.Equal(2, payload.Mood);
        Assert.Empty(oldErrors);
        Assert.Null(old!.Stress);
        Assert.Null(old.Mood);
    }


    [Fact]
    public void Date_is_required_and_a_date_only_payload_needs_parts()
    {
        var empty = new DailyCheckinPayload();

        Assert.Equal(new[] { "date", "parts" }, Errors(empty).Order(StringComparer.Ordinal));
        Assert.Equal(new[] { "parts" }, Errors(empty with { Date = Date }));
        // A parts list with every field null clears those parts.
        Assert.Empty(Errors(empty with { Date = Date, Parts = ["morning", "evening", "cardio"] }));
    }

    [Fact]
    public void A_single_part_is_valid()
    {
        Assert.Empty(Errors(new DailyCheckinPayload { Date = Date, Parts = ["morning"], SleepQuality = 4, EnergyWake = 3, Bowel = "loose" }));
        Assert.Empty(Errors(new DailyCheckinPayload { Date = Date, Parts = ["evening"], EnergyDay = 4, Anxiety = 2, WaterL = 3m, Note = "Exemplo." }));
        Assert.Empty(Errors(new DailyCheckinPayload { Date = Date, Parts = ["cardio"], CardioDone = true, CardioMinutes = 30 }));
        Assert.Empty(Errors(new DailyCheckinPayload { Date = Date, Parts = ["cardio"] }));
    }

    [Theory]
    [InlineData("night")]
    [InlineData("Morning")]
    [InlineData("")]
    public void Unknown_part_is_rejected(string part)
    {
        Assert.Equal(new[] { "parts" }, Errors(Valid with { Parts = ["morning", part] }));
    }

    [Fact]
    public void Empty_parts_list_is_rejected()
    {
        Assert.Equal(new[] { "parts" }, Errors(Valid with { Parts = [] }));
    }

    [Fact]
    public void A_written_part_with_some_data_must_be_complete()
    {
        var weightOnly = new DailyCheckinPayload { Date = Date, Parts = ["morning"], WeightKg = 80m };
        var noteOnly = new DailyCheckinPayload { Date = Date, Parts = ["evening"], Note = "Exemplo.", Anxiety = 2 };
        // Without parts every part is written: a lone sleep_quality is an incomplete morning.
        var legacy = new DailyCheckinPayload { Date = Date, SleepQuality = 4 };

        Assert.Equal(new[] { "bowel", "energy_wake", "sleep_quality" }, Errors(weightOnly).Order(StringComparer.Ordinal));
        Assert.Equal(new[] { "energy_day", "water_l" }, Errors(noteOnly).Order(StringComparer.Ordinal));
        Assert.Equal(new[] { "bowel", "energy_wake" }, Errors(legacy).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Evening_may_carry_water_or_a_note_without_the_scores()
    {
        Assert.Empty(Errors(new DailyCheckinPayload { Date = Date, Parts = ["evening"], WaterL = 1.5m }));
        Assert.Empty(Errors(new DailyCheckinPayload { Date = Date, Parts = ["evening"], WaterL = 0m, Note = "Exemplo." }));
        Assert.Empty(Errors(new DailyCheckinPayload { Date = Date, Parts = ["evening"], Note = "Exemplo." }));
        // The range still applies to water alone.
        Assert.Equal(new[] { "water_l" }, Errors(new DailyCheckinPayload { Date = Date, Parts = ["evening"], WaterL = 15.5m }));
    }

    [Fact]
    public void Evening_scores_come_together_and_with_the_water()
    {
        var energyOnly = new DailyCheckinPayload { Date = Date, Parts = ["evening"], EnergyDay = 4, WaterL = 2m };
        var anxietyOnly = new DailyCheckinPayload { Date = Date, Parts = ["evening"], Anxiety = 2, WaterL = 2m };
        var scoresWithoutWater = new DailyCheckinPayload { Date = Date, Parts = ["evening"], EnergyDay = 4, Anxiety = 2 };

        Assert.Equal(new[] { "anxiety" }, Errors(energyOnly));
        Assert.Equal(new[] { "energy_day" }, Errors(anxietyOnly));
        Assert.Equal(new[] { "water_l" }, Errors(scoresWithoutWater));
    }

    [Fact]
    public void Fields_of_parts_not_written_are_not_required()
    {
        Assert.Empty(Errors(new DailyCheckinPayload { Date = Date, Parts = ["evening"], SleepQuality = 4, EnergyDay = 4, Anxiety = 2, WaterL = 3m }));
    }

    [Theory]
    [InlineData("0")]
    [InlineData("15")]
    [InlineData("15.00")]
    [InlineData("2.25")]
    public void Water_accepts_0_to_15_liters(string liters)
    {
        Assert.Empty(Errors(Valid with { WaterL = Dec(liters) }));
    }

    [Theory]
    [InlineData("-0.01")]
    [InlineData("15.01")]
    [InlineData("2.255")]
    public void Water_rejects_out_of_range_or_too_precise(string liters)
    {
        Assert.Equal(new[] { "water_l" }, Errors(Valid with { WaterL = Dec(liters) }));
    }

    [Theory]
    [InlineData("30")]
    [InlineData("300")]
    [InlineData("82.35")]
    public void Weight_accepts_30_to_300_kg(string kg)
    {
        Assert.Empty(Errors(Valid with { WeightKg = Dec(kg) }));
    }

    [Theory]
    [InlineData("29.99")]
    [InlineData("300.01")]
    [InlineData("80.123")]
    public void Weight_rejects_out_of_range_or_too_precise(string kg)
    {
        Assert.Equal(new[] { "weight_kg" }, Errors(Valid with { WeightKg = Dec(kg) }));
    }

    [Theory]
    [InlineData("normal")]
    [InlineData("loose")]
    [InlineData("constipated")]
    public void Bowel_accepts_the_three_values(string bowel)
    {
        Assert.Empty(Errors(Valid with { Bowel = bowel }));
    }

    [Theory]
    [InlineData("Normal")]
    [InlineData("watery")]
    [InlineData("")]
    public void Bowel_rejects_anything_else(string bowel)
    {
        Assert.Equal(new[] { "bowel" }, Errors(Valid with { Bowel = bowel }));
    }

    [Fact]
    public void Note_accepts_up_to_2000_characters()
    {
        Assert.Empty(Errors(Valid with { Note = new string('a', 2000) }));
        Assert.Equal(new[] { "note" }, Errors(Valid with { Note = new string('a', 2001) }));
    }

    [Fact]
    public void Read_parses_snake_case_json()
    {
        var json = JsonDocument.Parse("""
            {"date":"2026-02-03","sleep_quality":4,"bowel":"loose","energy_wake":2,"energy_day":3,"anxiety":1,
             "water_l":3.25,"weight_kg":null,"note":"Exemplo."}
            """).RootElement;

        var payload = SyncPayload.Read(json, Validator, out var errors);

        Assert.Empty(errors);
        Assert.NotNull(payload);
        Assert.Equal(new DateOnly(2026, 2, 3), payload.Date);
        Assert.Equal(4, payload.SleepQuality);
        Assert.Equal("loose", payload.Bowel);
        Assert.Equal(3.25m, payload.WaterL);
        Assert.Null(payload.WeightKg);
    }

    [Theory]
    [InlineData("""{"date":"2026-02-03","sleep_quality":"good"}""", "invalid_payload:sleep_quality")]
    [InlineData("""{"date":"03/02/2026"}""", "invalid_payload:date")]
    [InlineData("""{"date":"2026-02-03","sleep_quality":4.5}""", "invalid_payload:sleep_quality")]
    [InlineData("""{"date":"2026-02-03","parts":"morning"}""", "invalid_payload:parts")]
    [InlineData("""{"date":"2026-02-03","parts":["morning",1]}""", "invalid_payload:parts")]
    [InlineData("[1, 2]", "invalid_payload")]
    [InlineData("\"text\"", "invalid_payload")]
    public void Read_maps_malformed_json_to_error_codes(string text, string expected)
    {
        var json = JsonDocument.Parse(text).RootElement;

        var payload = SyncPayload.Read(json, Validator, out var errors);

        Assert.Null(payload);
        Assert.Equal(new[] { expected }, errors);
    }

    [Fact]
    public void Read_reports_validation_failures_as_field_codes()
    {
        var json = SyncPayload.Write(Valid with { SleepQuality = 9, WaterL = 20m });

        var payload = SyncPayload.Read(json, Validator, out var errors);

        Assert.Null(payload);
        Assert.Equal(new[] { "invalid_payload:sleep_quality", "invalid_payload:water_l" }, errors.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Write_uses_snake_case_and_iso_date()
    {
        var json = SyncPayload.Write(Valid);

        Assert.Equal("2026-02-03", json.GetProperty("date").GetString());
        Assert.Equal(3, json.GetProperty("sleep_quality").GetInt32());
        Assert.Equal(2.5m, json.GetProperty("water_l").GetDecimal());
        Assert.Equal(80m, json.GetProperty("weight_kg").GetDecimal());
        Assert.Equal("normal", json.GetProperty("bowel").GetString());
        Assert.False(json.TryGetProperty("parts", out _));
    }
}
