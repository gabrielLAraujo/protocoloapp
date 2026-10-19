using System.Globalization;
using System.Text.Json;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Today;

[Collection("api")]
public sealed class TodaySyncTests(ApiFactory factory)
{
    private static readonly DateOnly Day = new(2026, 3, 10);

    private static JsonElement Json(params (string Key, object? Value)[] fields) =>
        JsonSerializer.SerializeToElement(fields.ToDictionary(f => f.Key, f => f.Value));

    private static SyncChange Upsert(string entity, Guid id, JsonElement payload) =>
        new(entity, id, SyncOp.Upsert, payload, SyncApi.Past(60));

    private static SyncChange Slot(Guid id, string slot, string dayType = "training", string time = "07:00", bool reminder = true) =>
        Upsert("schedule_slot", id, Json(("slot", slot), ("day_type", dayType), ("time", time), ("reminder_enabled", reminder)));

    private static SyncChange Adherence(
        Guid id,
        string key = "meal_1",
        string type = "meal",
        string status = "done",
        string? reason = null,
        string? note = null,
        DateOnly? date = null) =>
        Upsert("adherence_log", id, Json(
            ("date", (date ?? Day).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
            ("target_type", type),
            ("target_key", key),
            ("status", status),
            ("reason", reason),
            ("note", note)));

    private static void AssertRejected(SyncChangeResult result, string error)
    {
        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { error }, result.Errors);
    }

    private async Task<PlanApi> NewUserAsync() => await PlanApi.CreateAsync(factory);

    [Fact]
    public async Task Batch_of_three_slots_is_applied_and_pulled_in_version_order()
    {
        using var api = await NewUserAsync();
        var ids = new[] { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };

        var results = await SyncApi.PushAsync(
            api.Client,
            Slot(ids[0], "meal_1", "training", "07:00"),
            Slot(ids[1], "meal_1", "off", "08:30", reminder: false),
            Slot(ids[2], "before_bed", "training", "22:30"));

        Assert.All(results, r => Assert.Equal(SyncResultStatus.Applied, r.Status));
        var records = (await SyncApi.PullAllAsync(api.Client)).Where(r => r.Entity == "schedule_slot").ToList();
        Assert.Equal(ids, records.Select(r => r.Id));
        Assert.True(records.Zip(records.Skip(1), (a, b) => a.Version < b.Version).All(x => x));
        var off = records[1].Payload!.Value;
        Assert.Equal("meal_1", off.GetProperty("slot").GetString());
        Assert.Equal("off", off.GetProperty("day_type").GetString());
        Assert.Equal("08:30", off.GetProperty("time").GetString());
        Assert.False(off.GetProperty("reminder_enabled").GetBoolean());
    }

    [Theory]
    [InlineData("25:00")]
    [InlineData("7:00")]
    [InlineData("07:60")]
    [InlineData("07:00:00")]
    [InlineData("")]
    [InlineData("07:00\n")]
    public async Task Slot_with_invalid_time_is_invalid_payload_time(string time)
    {
        using var api = await NewUserAsync();

        var result = await SyncApi.PushOneAsync(api.Client, Slot(Guid.NewGuid(), "cardio", time: time));

        AssertRejected(result, "invalid_payload:time");
    }

    [Fact]
    public async Task Slot_accepts_the_day_limits()
    {
        using var api = await NewUserAsync();

        var midnight = await SyncApi.PushOneAsync(api.Client, Slot(Guid.NewGuid(), "cardio", time: "00:00"));
        var last = await SyncApi.PushOneAsync(api.Client, Slot(Guid.NewGuid(), "workout", time: "23:59"));

        Assert.Equal(SyncResultStatus.Applied, midnight.Status);
        Assert.Equal(SyncResultStatus.Applied, last.Status);
    }

    [Fact]
    public async Task Slot_with_unknown_day_type_is_invalid_payload_day_type()
    {
        using var api = await NewUserAsync();

        var result = await SyncApi.PushOneAsync(api.Client, Slot(Guid.NewGuid(), "cardio", dayType: "holiday"));

        AssertRejected(result, "invalid_payload:day_type");
    }

    [Fact]
    public async Task Slot_requires_reminder_flag()
    {
        using var api = await NewUserAsync();

        var result = await SyncApi.PushOneAsync(
            api.Client,
            Upsert("schedule_slot", Guid.NewGuid(), Json(("slot", "cardio"), ("day_type", "off"), ("time", "07:30"))));

        AssertRejected(result, "invalid_payload:reminder_enabled");
    }

    [Fact]
    public async Task Slot_is_unique_per_slot_and_day_type_among_live_rows()
    {
        using var api = await NewUserAsync();
        var first = Guid.NewGuid();

        var a = await SyncApi.PushOneAsync(api.Client, Slot(first, "cardio", "off", "07:30"));
        var duplicate = await SyncApi.PushOneAsync(api.Client, Slot(Guid.NewGuid(), "cardio", "off", "08:00"));
        var otherDayType = await SyncApi.PushOneAsync(api.Client, Slot(Guid.NewGuid(), "cardio", "training", "08:00"));
        var otherSlot = await SyncApi.PushOneAsync(api.Client, Slot(Guid.NewGuid(), "workout", "off", "08:00"));
        // The same id can change its own time.
        var samePk = await SyncApi.PushOneAsync(api.Client, new SyncChange("schedule_slot", first, SyncOp.Upsert, Json(("slot", "cardio"), ("day_type", "off"), ("time", "09:00"), ("reminder_enabled", true)), SyncApi.Past(30)));
        await SyncApi.PushAsync(api.Client, new SyncChange("schedule_slot", first, SyncOp.Delete, null, SyncApi.Past(5)));
        var reuse = await SyncApi.PushOneAsync(api.Client, Slot(Guid.NewGuid(), "cardio", "off", "10:00"));

        Assert.Equal(SyncResultStatus.Applied, a.Status);
        AssertRejected(duplicate, "slot_conflict");
        Assert.Equal(SyncResultStatus.Applied, otherDayType.Status);
        Assert.Equal(SyncResultStatus.Applied, otherSlot.Status);
        Assert.Equal(SyncResultStatus.Applied, samePk.Status);
        Assert.Equal(SyncResultStatus.Applied, reuse.Status);
    }

    [Fact]
    public async Task Slot_uniqueness_is_per_user()
    {
        using var one = await NewUserAsync();
        using var two = await NewUserAsync();

        var a = await SyncApi.PushOneAsync(one.Client, Slot(Guid.NewGuid(), "checkin", "off", "21:30"));
        var b = await SyncApi.PushOneAsync(two.Client, Slot(Guid.NewGuid(), "checkin", "off", "21:30"));

        Assert.Equal(SyncResultStatus.Applied, a.Status);
        Assert.Equal(SyncResultStatus.Applied, b.Status);
    }

    [Fact]
    public async Task Adherence_roundtrips_every_target_type_and_status()
    {
        using var api = await NewUserAsync();
        var done = Guid.NewGuid();
        var partial = Guid.NewGuid();
        var missed = Guid.NewGuid();

        var results = await SyncApi.PushAsync(
            api.Client,
            Adherence(done, "meal_1", "meal", "done", note: "ok"),
            Adherence(partial, "fasting", "protocol_item", "partial", reason: "no_time"),
            Adherence(missed, "cardio", "cardio", "missed", reason: "free_meal"),
            Adherence(Guid.NewGuid(), "workout", "workout"),
            Adherence(Guid.NewGuid(), "checkin", "checkin"));

        Assert.All(results, r => Assert.Equal(SyncResultStatus.Applied, r.Status));
        var records = (await SyncApi.PullAllAsync(api.Client)).Where(r => r.Entity == "adherence_log").ToList();
        Assert.Equal(5, records.Count);
        var p = records.Single(r => r.Id == partial).Payload!.Value;
        Assert.Equal("2026-03-10", p.GetProperty("date").GetString());
        Assert.Equal("protocol_item", p.GetProperty("target_type").GetString());
        Assert.Equal("fasting", p.GetProperty("target_key").GetString());
        Assert.Equal("partial", p.GetProperty("status").GetString());
        Assert.Equal("no_time", p.GetProperty("reason").GetString());
        var d = records.Single(r => r.Id == done).Payload!.Value;
        Assert.Equal("ok", d.GetProperty("note").GetString());
        Assert.Equal(JsonValueKind.Null, d.GetProperty("reason").ValueKind);
    }

    [Theory]
    [InlineData("partial", "tired")]
    [InlineData("missed", "")]
    [InlineData("done", "no_time")]
    public async Task Adherence_with_invalid_reason_is_invalid_payload_reason(string status, string reason)
    {
        using var api = await NewUserAsync();

        var result = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), status: status, reason: reason));

        AssertRejected(result, "invalid_payload:reason");
    }

    [Theory]
    [InlineData("no_appetite")]
    [InlineData("no_time")]
    [InlineData("felt_sick")]
    [InlineData("free_meal")]
    [InlineData("other")]
    public async Task Adherence_accepts_each_reason_for_missed(string reason)
    {
        using var api = await NewUserAsync();

        var result = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), status: "missed", reason: reason));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
    }

    [Theory]
    [InlineData("target_type", "snack")]
    [InlineData("status", "skipped")]
    [InlineData("target_key", "")]
    [InlineData("target_key", "has space")]
    [InlineData("target_key", "áé")]
    public async Task Adherence_rejects_invalid_fields(string field, string value)
    {
        using var api = await NewUserAsync();
        var payload = new Dictionary<string, object?>
        {
            ["date"] = "2026-03-10",
            ["target_type"] = "meal",
            ["target_key"] = "meal_1",
            ["status"] = "done",
            [field] = value,
        };

        var result = await SyncApi.PushOneAsync(api.Client, Upsert("adherence_log", Guid.NewGuid(), JsonSerializer.SerializeToElement(payload)));

        AssertRejected(result, $"invalid_payload:{field}");
    }

    [Fact]
    public async Task Adherence_key_and_note_length_limits()
    {
        using var api = await NewUserAsync();

        var key64 = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), key: new string('k', 64)));
        var key65 = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), key: new string('k', 65)));
        var note500 = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), key: "n1", note: new string('x', 500)));
        var note501 = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), key: "n2", note: new string('x', 501)));

        Assert.Equal(SyncResultStatus.Applied, key64.Status);
        AssertRejected(key65, "invalid_payload:target_key");
        Assert.Equal(SyncResultStatus.Applied, note500.Status);
        AssertRejected(note501, "invalid_payload:note");
    }

    [Fact]
    public async Task Adherence_is_unique_per_date_type_and_key_among_live_rows()
    {
        using var api = await NewUserAsync();
        var first = Guid.NewGuid();

        var a = await SyncApi.PushOneAsync(api.Client, Adherence(first));
        var duplicate = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), status: "missed", reason: "other"));
        var otherDate = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), date: Day.AddDays(1)));
        var otherType = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), type: "protocol_item"));
        var otherKey = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), key: "meal_2"));
        await SyncApi.PushAsync(api.Client, new SyncChange("adherence_log", first, SyncOp.Delete, null, SyncApi.Past(5)));
        var reuse = await SyncApi.PushOneAsync(api.Client, Adherence(Guid.NewGuid(), status: "partial"));

        Assert.Equal(SyncResultStatus.Applied, a.Status);
        AssertRejected(duplicate, "slot_conflict");
        Assert.Equal(SyncResultStatus.Applied, otherDate.Status);
        Assert.Equal(SyncResultStatus.Applied, otherType.Status);
        Assert.Equal(SyncResultStatus.Applied, otherKey.Status);
        Assert.Equal(SyncResultStatus.Applied, reuse.Status);
    }

    [Fact]
    public async Task Another_users_id_is_forbidden()
    {
        using var owner = await NewUserAsync();
        using var other = await NewUserAsync();
        var id = Guid.NewGuid();
        await SyncApi.PushAsync(owner.Client, Adherence(id));

        var result = await SyncApi.PushOneAsync(other.Client, Adherence(id));

        AssertRejected(result, "forbidden");
    }

    [Fact]
    public async Task Slot_with_trailing_newline_in_slot_is_invalid_payload_slot()
    {
        using var api = await NewUserAsync();

        var result = await SyncApi.PushOneAsync(api.Client, Slot(Guid.NewGuid(), "meal_1\n"));

        AssertRejected(result, "invalid_payload:slot");
    }

    [Fact]
    public async Task Older_client_updated_at_is_stale_for_both_entities()
    {
        using var api = await NewUserAsync();
        var slot = Guid.NewGuid();
        var log = Guid.NewGuid();
        await SyncApi.PushAsync(api.Client, Slot(slot, "cardio", time: "07:30"), Adherence(log));

        var staleSlot = await SyncApi.PushOneAsync(
            api.Client,
            new SyncChange("schedule_slot", slot, SyncOp.Upsert, Json(("slot", "cardio"), ("day_type", "training"), ("time", "09:00"), ("reminder_enabled", true)), SyncApi.Past(120)));
        var staleLog = await SyncApi.PushOneAsync(
            api.Client,
            new SyncChange("adherence_log", log, SyncOp.Upsert, Adherence(log, status: "missed").Payload, SyncApi.Past(120)));

        Assert.Equal(SyncResultStatus.Stale, staleSlot.Status);
        Assert.Equal(SyncResultStatus.Stale, staleLog.Status);
        var records = await SyncApi.PullAllAsync(api.Client);
        Assert.Equal("07:30", records.Single(r => r.Id == slot).Payload!.Value.GetProperty("time").GetString());
        Assert.Equal("done", records.Single(r => r.Id == log).Payload!.Value.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Reviving_a_deleted_row_rechecks_the_conflict()
    {
        using var api = await NewUserAsync();
        var slotA = Guid.NewGuid();
        var logA = Guid.NewGuid();
        await SyncApi.PushAsync(api.Client, Slot(slotA, "cardio", "off"), Adherence(logA));
        await SyncApi.PushAsync(
            api.Client,
            new SyncChange("schedule_slot", slotA, SyncOp.Delete, null, SyncApi.Past(10)),
            new SyncChange("adherence_log", logA, SyncOp.Delete, null, SyncApi.Past(10)));
        await SyncApi.PushAsync(api.Client, Slot(Guid.NewGuid(), "cardio", "off", "08:00"), Adherence(Guid.NewGuid()));

        var reviveSlot = await SyncApi.PushOneAsync(
            api.Client,
            new SyncChange("schedule_slot", slotA, SyncOp.Upsert, Json(("slot", "cardio"), ("day_type", "off"), ("time", "07:30"), ("reminder_enabled", true)), SyncApi.Past(1)));
        var reviveLog = await SyncApi.PushOneAsync(
            api.Client,
            new SyncChange("adherence_log", logA, SyncOp.Upsert, Adherence(logA).Payload, SyncApi.Past(1)));

        AssertRejected(reviveSlot, "slot_conflict");
        AssertRejected(reviveLog, "slot_conflict");
    }

    [Fact]
    public async Task Another_users_slot_id_is_forbidden()
    {
        using var owner = await NewUserAsync();
        using var other = await NewUserAsync();
        var id = Guid.NewGuid();
        await SyncApi.PushAsync(owner.Client, Slot(id, "cardio"));

        var result = await SyncApi.PushOneAsync(other.Client, Slot(id, "cardio"));

        AssertRejected(result, "forbidden");
    }
}
