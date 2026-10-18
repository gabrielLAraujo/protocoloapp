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

    [Fact]
    public void Required_fields_must_be_present()
    {
        var empty = new DailyCheckinPayload();

        Assert.Equal(
            new[] { "anxiety", "bowel", "date", "energy_day", "energy_wake", "sleep_quality", "water_l" },
            Errors(empty).Order(StringComparer.Ordinal));
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
    }
}
