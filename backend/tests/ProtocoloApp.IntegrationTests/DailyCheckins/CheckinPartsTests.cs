using System.Globalization;
using System.Text.Json;
using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Auth;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.DailyCheckins;

/// <summary>The check-in saved in parts (morning, evening, cardio): field-wise merge on the server. Fictitious values.</summary>
[Collection("api")]
public sealed class CheckinPartsTests(ApiFactory factory)
{
    private static readonly DateOnly Day = new(2026, 4, 14);

    private Task<HttpClient> NewUserAsync() => factory.CreateAuthenticatedClientAsync(AuthApi.NewEmail());

    private static SyncChange Upsert(Guid id, DateTimeOffset at, params (string Key, object? Value)[] fields)
    {
        var payload = new Dictionary<string, object?> { ["date"] = Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) };
        foreach (var (key, value) in fields)
            payload[key] = value;
        return new SyncChange(SyncApi.Entity, id, SyncOp.Upsert, JsonSerializer.SerializeToElement(payload), at);
    }

    // What the morning screen sends: its part, the other part's fields as null (nothing pulled yet).
    private static SyncChange Morning(Guid id, DateTimeOffset at) => Upsert(id, at,
        ("sleep_quality", 4), ("energy_wake", 3), ("bowel", "loose"), ("weight_kg", 80.4m),
        ("energy_day", null), ("anxiety", null), ("water_l", null), ("note", null));

    private static SyncChange Evening(Guid id, DateTimeOffset at) => Upsert(id, at,
        ("sleep_quality", null), ("energy_wake", null), ("bowel", null), ("weight_kg", null),
        ("energy_day", 2), ("anxiety", 5), ("water_l", 3.25m), ("note", "Dia corrido."));

    private static async Task<JsonElement> PulledAsync(HttpClient client, Guid id) =>
        (await SyncApi.PullAllAsync(client)).Single(r => r.Id == id).Payload!.Value;

    [Fact]
    public async Task Morning_on_one_device_and_evening_on_another_keep_both_parts()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        var morning = await SyncApi.PushOneAsync(client, Morning(id, SyncApi.Past(60)));
        // The second device never pulled the morning: its evening payload carries the morning fields as null.
        var evening = await SyncApi.PushOneAsync(client, Evening(id, SyncApi.Past(10)));

        Assert.Equal(SyncResultStatus.Applied, morning.Status);
        Assert.Equal(SyncResultStatus.Applied, evening.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Equal(4, row.SleepQuality);
        Assert.Equal(3, row.EnergyWake);
        Assert.Equal(Bowel.Loose, row.Bowel);
        Assert.Equal(80.4m, row.WeightKg);
        Assert.Equal(2, row.EnergyDay);
        Assert.Equal(5, row.Anxiety);
        Assert.Equal(3.25m, row.WaterL);
        Assert.Equal("Dia corrido.", row.Note);
        var payload = await PulledAsync(client, id);
        Assert.Equal(4, payload.GetProperty("sleep_quality").GetInt32());
        Assert.Equal("loose", payload.GetProperty("bowel").GetString());
        Assert.Equal(5, payload.GetProperty("anxiety").GetInt32());
    }

    [Fact]
    public async Task Older_part_is_still_stale_and_merges_nothing()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Evening(id, SyncApi.Past(10)));
        var older = await SyncApi.PushOneAsync(client, Morning(id, SyncApi.Past(60)));

        Assert.Equal(SyncResultStatus.Stale, older.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Null(row.SleepQuality);
        Assert.Equal(2, row.EnergyDay);
    }

    [Fact]
    public async Task Cardio_only_payload_creates_a_row_with_null_parts()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        var result = await SyncApi.PushOneAsync(client, Upsert(id, SyncApi.Past(), ("cardio_done", true), ("cardio_minutes", 25)));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.True(row.CardioDone);
        Assert.Equal(25, row.CardioMinutes);
        Assert.Null(row.SleepQuality);
        Assert.Null(row.Bowel);
        Assert.Null(row.WaterL);
        var payload = await PulledAsync(client, id);
        foreach (var field in new[] { "sleep_quality", "bowel", "energy_wake", "energy_day", "anxiety", "water_l", "weight_kg", "note" })
            Assert.Equal(JsonValueKind.Null, payload.GetProperty(field).ValueKind);
        Assert.Equal(25, payload.GetProperty("cardio_minutes").GetInt32());
    }

    [Fact]
    public async Task A_part_after_cardio_keeps_the_cardio()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Upsert(id, SyncApi.Past(60), ("cardio_done", true), ("cardio_minutes", 25)));
        await SyncApi.PushOneAsync(client, Morning(id, SyncApi.Past(10)));

        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.True(row.CardioDone);
        Assert.Equal(25, row.CardioMinutes);
        Assert.Equal(4, row.SleepQuality);
    }

    [Fact]
    public async Task Cardio_not_done_drops_the_stored_minutes()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Upsert(id, SyncApi.Past(60), ("cardio_done", true), ("cardio_minutes", 25)));
        var result = await SyncApi.PushOneAsync(client, Upsert(id, SyncApi.Past(10), ("cardio_done", false)));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.False(row.CardioDone);
        Assert.Null(row.CardioMinutes);
    }

    [Theory]
    [InlineData("sleep_quality", 0)]
    [InlineData("energy_wake", 6)]
    [InlineData("energy_day", 0)]
    [InlineData("anxiety", 6)]
    [InlineData("water_l", 16)]
    public async Task Out_of_range_part_field_is_rejected(string field, int value)
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        var result = await SyncApi.PushOneAsync(client, Upsert(id, SyncApi.Past(), (field, value)));

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { $"invalid_payload:{field}" }, result.Errors!);
        Assert.Empty(await SyncApi.RowsAsync(factory, id));
    }

    [Fact]
    public async Task Invalid_bowel_is_rejected()
    {
        using var client = await NewUserAsync();

        var result = await SyncApi.PushOneAsync(client, Upsert(Guid.NewGuid(), SyncApi.Past(), ("bowel", "watery")));

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { "invalid_payload:bowel" }, result.Errors!);
    }

    [Fact]
    public async Task Empty_note_clears_and_null_note_keeps()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Evening(id, SyncApi.Past(60)));
        await SyncApi.PushOneAsync(client, Upsert(id, SyncApi.Past(50), ("note", null), ("anxiety", 3)));
        var kept = Assert.Single(await SyncApi.RowsAsync(factory, id));
        var result = await SyncApi.PushOneAsync(client, Upsert(id, SyncApi.Past(40), ("note", "")));

        Assert.Equal("Dia corrido.", kept.Note);
        Assert.Equal(3, kept.Anxiety);
        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Null(row.Note);
        Assert.Equal(3, row.Anxiety);
        Assert.Equal(JsonValueKind.Null, (await PulledAsync(client, id)).GetProperty("note").ValueKind);
    }

    [Fact]
    public async Task Upsert_after_delete_starts_from_empty_fields()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Morning(id, SyncApi.Past(60)));
        await SyncApi.PushOneAsync(client, SyncApi.Delete(id, SyncApi.Past(50)));
        var result = await SyncApi.PushOneAsync(client, Evening(id, SyncApi.Past(40)));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Null(row.DeletedAt);
        Assert.Null(row.SleepQuality);
        Assert.Null(row.WeightKg);
        Assert.Equal(2, row.EnergyDay);
    }
}
