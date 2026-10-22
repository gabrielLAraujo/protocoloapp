using System.Globalization;
using System.Text.Json;
using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Auth;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.DailyCheckins;

/// <summary>
/// The check-in saved in parts (<c>parts</c>: morning, evening, cardio), each with its own last-write-wins clock.
/// Fictitious values.
/// </summary>
public sealed class CheckinPartsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateOnly Day = new(2026, 4, 14);

    private Task<HttpClient> NewUserAsync() => factory.CreateAuthenticatedClientAsync(AuthApi.NewEmail());

    /// <summary>Whole seconds in the past, so the stored (microsecond) clock compares equal.</summary>
    private static DateTimeOffset At(int minutesAgo)
    {
        var at = SyncApi.Past(minutesAgo);
        return new DateTimeOffset(at.UtcTicks - (at.UtcTicks % TimeSpan.TicksPerSecond), TimeSpan.Zero);
    }

    private static SyncChange Upsert(Guid id, DateTimeOffset at, string[]? parts, params (string Key, object? Value)[] fields)
    {
        var payload = new Dictionary<string, object?> { ["date"] = Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) };
        if (parts is not null)
            payload["parts"] = parts;
        foreach (var (key, value) in fields)
            payload[key] = value;
        return new SyncChange(SyncApi.Entity, id, SyncOp.Upsert, JsonSerializer.SerializeToElement(payload), at);
    }

    // What the morning screen sends: the whole local row, the evening still empty (nothing pulled yet).
    private static SyncChange Morning(Guid id, DateTimeOffset at, int sleepQuality = 4) => Upsert(id, at, ["morning"],
        ("sleep_quality", sleepQuality), ("energy_wake", 3), ("bowel", "loose"), ("weight_kg", 80.4m),
        ("energy_day", null), ("anxiety", null), ("water_l", null), ("note", null));

    private static SyncChange Evening(Guid id, DateTimeOffset at) => Upsert(id, at, ["evening"],
        ("sleep_quality", null), ("energy_wake", null), ("bowel", null), ("weight_kg", null),
        ("energy_day", 2), ("anxiety", 5), ("water_l", 3.25m), ("note", "Dia corrido."));

    private static SyncChange Cardio(Guid id, DateTimeOffset at, bool? done, int? minutes) =>
        Upsert(id, at, ["cardio"], ("cardio_done", done), ("cardio_minutes", minutes));

    private static async Task<SyncRecord> PulledAsync(HttpClient client, Guid id) =>
        (await SyncApi.PullAllAsync(client)).Single(r => r.Id == id);

    private static void AssertMorning(DailyCheckin row)
    {
        Assert.Equal(4, row.SleepQuality);
        Assert.Equal(3, row.EnergyWake);
        Assert.Equal(Bowel.Loose, row.Bowel);
        Assert.Equal(80.4m, row.WeightKg);
    }

    private static void AssertEvening(DailyCheckin row)
    {
        Assert.Equal(2, row.EnergyDay);
        Assert.Equal(5, row.Anxiety);
        Assert.Equal(3.25m, row.WaterL);
        Assert.Equal("Dia corrido.", row.Note);
    }

    [Fact]
    public async Task Evening_part_keeps_the_morning_fields()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Morning(id, At(60)));
        var result = await SyncApi.PushOneAsync(client, Evening(id, At(10)));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        AssertMorning(row);
        AssertEvening(row);
        var payload = (await PulledAsync(client, id)).Payload!.Value;
        Assert.Equal(4, payload.GetProperty("sleep_quality").GetInt32());
        Assert.Equal(5, payload.GetProperty("anxiety").GetInt32());
        Assert.False(payload.TryGetProperty("parts", out _));
    }

    [Fact]
    public async Task Water_alone_in_the_evening_part_persists_and_the_full_evening_keeps_it()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        // Water logged on Hoje during the day: the evening part with no scores yet.
        var water = await SyncApi.PushOneAsync(client, Upsert(id, At(60), ["evening"],
            ("energy_day", null), ("anxiety", null), ("water_l", 1.5m), ("note", null)));

        Assert.Equal(SyncResultStatus.Applied, water.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Equal(1.5m, row.WaterL);
        Assert.Null(row.EnergyDay);
        Assert.Null(row.Anxiety);

        // The evening check-in later sends the whole part with the water as it stands on the device.
        var evening = await SyncApi.PushOneAsync(client, Upsert(id, At(10), ["evening"],
            ("energy_day", 4), ("anxiety", 2), ("water_l", 1.5m), ("note", "Dia leve.")));

        Assert.Equal(SyncResultStatus.Applied, evening.Status);
        row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Equal(1.5m, row.WaterL);
        Assert.Equal(4, row.EnergyDay);
        Assert.Equal(2, row.Anxiety);
        Assert.Equal("Dia leve.", row.Note);
    }

    [Fact]
    public async Task Evening_score_without_the_other_is_rejected()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        var result = await SyncApi.PushOneAsync(client, Upsert(id, At(5), ["evening"], ("energy_day", 4), ("water_l", 2m)));

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { "invalid_payload:anxiety" }, result.Errors!);
        Assert.Empty(await SyncApi.RowsAsync(factory, id));
    }

    [Fact]
    public async Task Morning_saved_offline_earlier_but_pushed_after_a_newer_evening_keeps_both()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();
        var t1 = At(60);
        var t2 = At(10);

        // The PC pushes the evening (t2) first; the phone comes online later with its morning saved at t1 < t2.
        var evening = await SyncApi.PushOneAsync(client, Evening(id, t2));
        var morning = await SyncApi.PushOneAsync(client, Morning(id, t1));

        Assert.Equal(SyncResultStatus.Applied, evening.Status);
        Assert.Equal(SyncResultStatus.Applied, morning.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        AssertMorning(row);
        AssertEvening(row);
        Assert.Equal(t1, row.MorningClientUpdatedAt);
        Assert.Equal(t2, row.EveningClientUpdatedAt);
        Assert.Null(row.CardioClientUpdatedAt);
        Assert.Equal(t2, row.ClientUpdatedAt);
        Assert.Equal(t2, (await PulledAsync(client, id)).ClientUpdatedAt);
    }

    [Fact]
    public async Task Older_morning_after_a_newer_morning_is_stale()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Morning(id, At(10), sleepQuality: 5));
        var version = Assert.Single(await SyncApi.RowsAsync(factory, id)).Version;
        var older = await SyncApi.PushOneAsync(client, Morning(id, At(60), sleepQuality: 1));

        Assert.Equal(SyncResultStatus.Stale, older.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Equal(5, row.SleepQuality);
        Assert.Equal(version, row.Version);
    }

    [Fact]
    public async Task Legacy_payload_overwrites_only_the_parts_it_is_newer_than()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        // Morning at t3 and evening at t1; a full legacy write at t2 (t1 < t2 < t3) only beats the evening.
        await SyncApi.PushOneAsync(client, Morning(id, At(10)));
        await SyncApi.PushOneAsync(client, Evening(id, At(60)));
        var legacy = await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, At(30), sleepQuality: 1, note: "Outro dia."));

        Assert.Equal(SyncResultStatus.Applied, legacy.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        AssertMorning(row);
        Assert.Equal("Outro dia.", row.Note);
        Assert.Equal(4, row.EnergyDay);
    }

    [Fact]
    public async Task Legacy_full_payload_older_than_every_part_clock_is_stale()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Morning(id, At(20)));
        await SyncApi.PushOneAsync(client, Evening(id, At(15)));
        await SyncApi.PushOneAsync(client, Cardio(id, At(10), true, 25));
        var version = Assert.Single(await SyncApi.RowsAsync(factory, id)).Version;
        var legacy = await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, At(30), sleepQuality: 1));

        Assert.Equal(SyncResultStatus.Stale, legacy.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Equal(version, row.Version);
        AssertMorning(row);
        AssertEvening(row);
        Assert.True(row.CardioDone);
    }

    [Fact]
    public async Task Cardio_part_alone_creates_a_row_with_null_parts()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        var result = await SyncApi.PushOneAsync(client, Cardio(id, At(5), true, 25));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.True(row.CardioDone);
        Assert.Equal(25, row.CardioMinutes);
        Assert.Null(row.MorningClientUpdatedAt);
        var payload = (await PulledAsync(client, id)).Payload!.Value;
        foreach (var field in new[] { "sleep_quality", "bowel", "energy_wake", "energy_day", "anxiety", "water_l", "weight_kg", "note" })
            Assert.Equal(JsonValueKind.Null, payload.GetProperty(field).ValueKind);
        Assert.Equal(25, payload.GetProperty("cardio_minutes").GetInt32());
    }

    [Fact]
    public async Task Cardio_part_with_done_null_clears_both_cardio_fields_and_keeps_the_rest()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Morning(id, At(60)));
        await SyncApi.PushOneAsync(client, Cardio(id, At(50), true, 25));
        var result = await SyncApi.PushOneAsync(client, Cardio(id, At(40), null, null));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Null(row.CardioDone);
        Assert.Null(row.CardioMinutes);
        AssertMorning(row);
    }

    [Fact]
    public async Task Listed_part_with_every_field_null_clears_it()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Morning(id, At(60)));
        await SyncApi.PushOneAsync(client, Evening(id, At(50)));
        var result = await SyncApi.PushOneAsync(client, Upsert(id, At(40), ["evening"],
            ("energy_day", null), ("anxiety", null), ("water_l", null), ("note", null)));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Null(row.EnergyDay);
        Assert.Null(row.Note);
        AssertMorning(row);
    }

    [Fact]
    public async Task Unknown_part_is_rejected()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        var result = await SyncApi.PushOneAsync(client, Upsert(id, At(5), ["night"], ("energy_day", 2)));

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { "invalid_payload:parts" }, result.Errors!);
        Assert.Empty(await SyncApi.RowsAsync(factory, id));
    }

    [Fact]
    public async Task Incomplete_part_is_rejected()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        var result = await SyncApi.PushOneAsync(client, Upsert(id, At(5), ["morning"], ("sleep_quality", 4), ("bowel", "normal")));

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { "invalid_payload:energy_wake" }, result.Errors!);
        Assert.Empty(await SyncApi.RowsAsync(factory, id));
    }

    [Fact]
    public async Task Date_only_payload_without_parts_is_rejected()
    {
        using var client = await NewUserAsync();

        var result = await SyncApi.PushOneAsync(client, Upsert(Guid.NewGuid(), At(5), null));

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { "invalid_payload:parts" }, result.Errors!);
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
        var payload = SyncApi.Checkin(id, Day, At(5));
        var fields = JsonSerializer.Deserialize<Dictionary<string, object?>>(payload.Payload!.Value.GetRawText())!;
        fields[field] = value;

        var result = await SyncApi.PushOneAsync(client, payload with { Payload = JsonSerializer.SerializeToElement(fields) });

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { $"invalid_payload:{field}" }, result.Errors!);
        Assert.Empty(await SyncApi.RowsAsync(factory, id));
    }

    [Fact]
    public async Task Upsert_after_delete_starts_from_empty_fields()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Morning(id, At(60)));
        await SyncApi.PushOneAsync(client, SyncApi.Delete(id, At(50)));
        var result = await SyncApi.PushOneAsync(client, Evening(id, At(40)));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Null(row.DeletedAt);
        Assert.Null(row.SleepQuality);
        Assert.Null(row.WeightKg);
        Assert.Null(row.MorningClientUpdatedAt);
        AssertEvening(row);
    }

    [Fact]
    public async Task Part_older_than_the_delete_is_stale()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, Evening(id, At(60)));
        await SyncApi.PushOneAsync(client, SyncApi.Delete(id, At(40)));
        var result = await SyncApi.PushOneAsync(client, Morning(id, At(50)));

        Assert.Equal(SyncResultStatus.Stale, result.Status);
        Assert.NotNull(Assert.Single(await SyncApi.RowsAsync(factory, id)).DeletedAt);
    }
}
