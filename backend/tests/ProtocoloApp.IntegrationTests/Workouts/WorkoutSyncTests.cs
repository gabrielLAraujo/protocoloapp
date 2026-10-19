using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Workouts;

[Collection("api")]
public sealed class WorkoutSyncTests(ApiFactory factory)
{
    private static readonly DateOnly Day = new(2026, 3, 10);

    private sealed record Setup(PlanApi Api, Guid PlanVersionId, Guid ExerciseId);

    // An active workout plan (so there is a plan version and the catalog has exercises), all through the real endpoints.
    private async Task<Setup> NewUserAsync()
    {
        var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync();
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id)).StatusCode);
        var exercise = await api.WithDbAsync(db => db.Exercises.AsNoTracking().FirstAsync(e => e.UserId == api.UserId));
        return new Setup(api, draft.Id, exercise.Id);
    }

    private static JsonElement Json(params (string Key, object? Value)[] fields) =>
        JsonSerializer.SerializeToElement(fields.ToDictionary(f => f.Key, f => f.Value));

    private static SyncChange Upsert(string entity, Guid id, JsonElement payload, int minutesAgo = 60) =>
        new(entity, id, SyncOp.Upsert, payload, SyncApi.Past(minutesAgo));

    private static SyncChange Session(Guid id, Guid planVersionId, string dayKey = "a", string? note = null, int minutesAgo = 60) =>
        Upsert("workout_session", id, Json(
            ("date", Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
            ("plan_version_id", planVersionId),
            ("workout_day_key", dayKey),
            ("started_at", SyncApi.Past(90)),
            ("ended_at", null),
            ("note", note)), minutesAgo);

    private static SyncChange Set(Guid id, Guid sessionId, Guid exerciseId, int index = 0, string kind = "normal", Guid? parent = null, decimal weight = 60.5m, int reps = 10) =>
        Upsert("set_log", id, Json(
            ("session_id", sessionId),
            ("exercise_id", exerciseId),
            ("planned_exercise_key", "bench"),
            ("set_index", index),
            ("weight_kg", weight),
            ("reps", reps),
            ("kind", kind),
            ("parent_set_id", parent),
            ("completed_at", SyncApi.Past(80))));

    private static SyncChange Change(Guid id, Guid sessionId, string action, Guid? replacement) =>
        Upsert("exercise_change", id, Json(
            ("session_id", sessionId),
            ("planned_exercise_key", "bench"),
            ("action", action),
            ("replacement_exercise_id", replacement),
            ("note", null)));

    private static SyncChange Override(Guid id, DateOnly date, string key = "off") =>
        Upsert("rotation_override", id, Json(("date", date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)), ("workout_day_key", key)));

    private static void AssertRejected(SyncChangeResult result, string error)
    {
        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { error }, result.Errors);
    }

    [Fact]
    public async Task Session_and_its_sets_in_one_batch_are_applied_in_order_and_pulled_in_version_order()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var session = Guid.NewGuid();
        var sets = new[] { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };

        var results = await SyncApi.PushAsync(
            api.Client,
            Session(session, s.PlanVersionId),
            Set(sets[0], session, s.ExerciseId, 0),
            Set(sets[1], session, s.ExerciseId, 1, kind: "drop", parent: sets[0]),
            Set(sets[2], session, s.ExerciseId, 2, kind: "warmup"));

        Assert.All(results, r => Assert.Equal(SyncResultStatus.Applied, r.Status));
        var records = (await SyncApi.PullAllAsync(api.Client)).Where(r => r.Entity is "workout_session" or "set_log").ToList();
        Assert.Equal(new[] { session, sets[0], sets[1], sets[2] }, records.Select(r => r.Id));
        Assert.True(records.Zip(records.Skip(1), (a, b) => a.Version < b.Version).All(x => x));
        var drop = records[2].Payload!.Value;
        Assert.Equal("drop", drop.GetProperty("kind").GetString());
        Assert.Equal(sets[0], drop.GetProperty("parent_set_id").GetGuid());
        Assert.Equal(60.5m, drop.GetProperty("weight_kg").GetDecimal());
        Assert.Equal(s.ExerciseId, drop.GetProperty("exercise_id").GetGuid());
        Assert.Equal(s.PlanVersionId, records[0].Payload!.Value.GetProperty("plan_version_id").GetGuid());
    }

    [Fact]
    public async Task Set_of_another_users_session_is_invalid_reference()
    {
        var owner = await NewUserAsync();
        var other = await NewUserAsync();
        using var ownerApi = owner.Api;
        using var otherApi = other.Api;
        var session = Guid.NewGuid();
        await SyncApi.PushAsync(ownerApi.Client, Session(session, owner.PlanVersionId));

        var foreignSession = await SyncApi.PushOneAsync(otherApi.Client, Set(Guid.NewGuid(), session, other.ExerciseId));
        var mySession = Guid.NewGuid();
        await SyncApi.PushAsync(otherApi.Client, Session(mySession, other.PlanVersionId));
        var foreignExercise = await SyncApi.PushOneAsync(otherApi.Client, Set(Guid.NewGuid(), mySession, owner.ExerciseId));
        var missingSession = await SyncApi.PushOneAsync(otherApi.Client, Set(Guid.NewGuid(), Guid.NewGuid(), other.ExerciseId));

        AssertRejected(foreignSession, "invalid_reference");
        AssertRejected(foreignExercise, "invalid_reference");
        AssertRejected(missingSession, "invalid_reference");
    }

    [Fact]
    public async Task Session_of_another_users_plan_version_is_invalid_reference_but_an_archived_one_is_valid()
    {
        var owner = await NewUserAsync();
        var other = await NewUserAsync();
        using var ownerApi = owner.Api;
        using var otherApi = other.Api;

        var foreign = await SyncApi.PushOneAsync(otherApi.Client, Session(Guid.NewGuid(), owner.PlanVersionId));
        // Activating a newer plan archives the first one; sessions may still point at it.
        var second = await ownerApi.ImportDraftAsync();
        Assert.Equal(HttpStatusCode.OK, (await ownerApi.ActivateAsync(second.Id)).StatusCode);
        var archived = await ownerApi.GetAsync(owner.PlanVersionId);
        var onArchived = await SyncApi.PushOneAsync(ownerApi.Client, Session(Guid.NewGuid(), owner.PlanVersionId));

        AssertRejected(foreign, "invalid_reference");
        Assert.Equal(PlanStatus.Archived, archived.Status);
        Assert.Equal(SyncResultStatus.Applied, onArchived.Status);
    }

    [Fact]
    public async Task Set_before_its_session_in_the_batch_is_invalid_reference_and_works_once_the_session_is_stored()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var session = Guid.NewGuid();
        var set = Guid.NewGuid();

        var early = await SyncApi.PushAsync(api.Client, Set(set, session, s.ExerciseId), Session(session, s.PlanVersionId));
        var retry = await SyncApi.PushOneAsync(api.Client, Set(set, session, s.ExerciseId));

        AssertRejected(early[0], "invalid_reference");
        Assert.Equal(SyncResultStatus.Applied, early[1].Status);
        Assert.Equal(SyncResultStatus.Applied, retry.Status);
    }

    [Fact]
    public async Task Set_of_a_deleted_session_or_with_a_missing_parent_is_invalid_reference()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var session = Guid.NewGuid();
        await SyncApi.PushAsync(api.Client, Session(session, s.PlanVersionId));

        var badParent = await SyncApi.PushOneAsync(api.Client, Set(Guid.NewGuid(), session, s.ExerciseId, kind: "drop", parent: Guid.NewGuid()));
        var selfParentId = Guid.NewGuid();
        var selfParent = await SyncApi.PushOneAsync(api.Client, Set(selfParentId, session, s.ExerciseId, kind: "drop", parent: selfParentId));
        await SyncApi.PushAsync(api.Client, new SyncChange("workout_session", session, SyncOp.Delete, null, SyncApi.Past(10)));
        var afterDelete = await SyncApi.PushOneAsync(api.Client, Set(Guid.NewGuid(), session, s.ExerciseId));

        AssertRejected(badParent, "invalid_reference");
        AssertRejected(selfParent, "invalid_reference");
        AssertRejected(afterDelete, "invalid_reference");
    }

    [Theory]
    [InlineData("kind", "super")]
    [InlineData("reps", 201)]
    [InlineData("weight_kg", 1000.5)]
    [InlineData("set_index", 51)]
    public async Task Set_with_out_of_range_fields_is_invalid_payload(string field, object value)
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var session = Guid.NewGuid();
        await SyncApi.PushAsync(api.Client, Session(session, s.PlanVersionId));
        var payload = JsonSerializer.Deserialize<Dictionary<string, object?>>(Set(Guid.NewGuid(), session, s.ExerciseId).Payload!.Value.GetRawText())!;
        payload[field] = value;
        var change = Upsert("set_log", Guid.NewGuid(), JsonSerializer.SerializeToElement(payload));

        AssertRejected(await SyncApi.PushOneAsync(api.Client, change), $"invalid_payload:{field}");
    }

    [Fact]
    public async Task Swapped_needs_a_replacement_exercise_and_skipped_drops_it()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var session = Guid.NewGuid();
        await SyncApi.PushAsync(api.Client, Session(session, s.PlanVersionId));
        var skippedId = Guid.NewGuid();

        var noReplacement = await SyncApi.PushOneAsync(api.Client, Change(Guid.NewGuid(), session, "swapped", null));
        var unknownReplacement = await SyncApi.PushOneAsync(api.Client, Change(Guid.NewGuid(), session, "swapped", Guid.NewGuid()));
        var swapped = await SyncApi.PushOneAsync(api.Client, Change(Guid.NewGuid(), session, "swapped", s.ExerciseId));
        var skipped = await SyncApi.PushOneAsync(api.Client, Change(skippedId, session, "skipped", s.ExerciseId));
        var badAction = await SyncApi.PushOneAsync(api.Client, Change(Guid.NewGuid(), session, "moved", null));

        AssertRejected(noReplacement, "invalid_payload:replacement_exercise_id");
        AssertRejected(unknownReplacement, "invalid_reference");
        Assert.Equal(SyncResultStatus.Applied, swapped.Status);
        Assert.Equal(SyncResultStatus.Applied, skipped.Status);
        AssertRejected(badAction, "invalid_payload:action");
        var record = (await SyncApi.PullAllAsync(api.Client)).Single(r => r.Id == skippedId);
        Assert.Equal(JsonValueKind.Null, record.Payload!.Value.GetProperty("replacement_exercise_id").ValueKind);
    }

    [Fact]
    public async Task Rotation_override_is_unique_per_date_among_live_rows()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();

        var a = await SyncApi.PushOneAsync(api.Client, Override(first, Day));
        var duplicate = await SyncApi.PushOneAsync(api.Client, Override(second, Day, "a"));
        var otherDay = await SyncApi.PushOneAsync(api.Client, Override(second, Day.AddDays(1), "a"));
        // Deleting the first frees its date for another row.
        await SyncApi.PushAsync(api.Client, new SyncChange("rotation_override", first, SyncOp.Delete, null, SyncApi.Past(5)));
        var reuse = await SyncApi.PushOneAsync(api.Client, Override(Guid.NewGuid(), Day, "b"));

        Assert.Equal(SyncResultStatus.Applied, a.Status);
        AssertRejected(duplicate, "date_conflict");
        Assert.Equal(SyncResultStatus.Applied, otherDay.Status);
        Assert.Equal(SyncResultStatus.Applied, reuse.Status);
    }

    [Fact]
    public async Task Rotation_override_requires_a_day_key()
    {
        var s = await NewUserAsync();
        using var api = s.Api;

        var result = await SyncApi.PushOneAsync(api.Client, Upsert("rotation_override", Guid.NewGuid(), Json(("date", "2026-03-10"), ("workout_day_key", ""))));

        AssertRejected(result, "invalid_payload:workout_day_key");
    }

    [Fact]
    public async Task Checkin_cardio_fields_roundtrip_and_are_validated()
    {
        var s = await NewUserAsync();
        using var api = s.Api;

        static SyncChange Checkin(Guid id, DateOnly date, bool? done, int? minutes)
        {
            var payload = JsonSerializer.Deserialize<Dictionary<string, object?>>(SyncApi.Payload(date).GetRawText())!;
            payload["cardio_done"] = done;
            payload["cardio_minutes"] = minutes;
            return new SyncChange(SyncApi.Entity, id, SyncOp.Upsert, JsonSerializer.SerializeToElement(payload), SyncApi.Past());
        }

        var okId = Guid.NewGuid();
        var ok = await SyncApi.PushOneAsync(api.Client, Checkin(okId, Day, true, 35));
        var notDone = await SyncApi.PushOneAsync(api.Client, Checkin(Guid.NewGuid(), Day.AddDays(1), false, 20));
        var unanswered = await SyncApi.PushOneAsync(api.Client, Checkin(Guid.NewGuid(), Day.AddDays(2), null, 20));
        var tooMuch = await SyncApi.PushOneAsync(api.Client, Checkin(Guid.NewGuid(), Day.AddDays(3), true, 301));
        var negative = await SyncApi.PushOneAsync(api.Client, Checkin(Guid.NewGuid(), Day.AddDays(4), true, -1));
        var doneNoMinutes = await SyncApi.PushOneAsync(api.Client, Checkin(Guid.NewGuid(), Day.AddDays(5), true, null));

        Assert.Equal(SyncResultStatus.Applied, ok.Status);
        AssertRejected(notDone, "invalid_payload:cardio_minutes");
        AssertRejected(unanswered, "invalid_payload:cardio_minutes");
        AssertRejected(tooMuch, "invalid_payload:cardio_minutes");
        AssertRejected(negative, "invalid_payload:cardio_minutes");
        Assert.Equal(SyncResultStatus.Applied, doneNoMinutes.Status);
        var payload = (await SyncApi.PullAllAsync(api.Client)).Single(r => r.Id == okId).Payload!.Value;
        Assert.True(payload.GetProperty("cardio_done").GetBoolean());
        Assert.Equal(35, payload.GetProperty("cardio_minutes").GetInt32());
    }

    [Fact]
    public async Task Old_checkin_payload_without_cardio_fields_is_valid_and_clears_stored_cardio()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var id = Guid.NewGuid();
        var withCardio = JsonSerializer.Deserialize<Dictionary<string, object?>>(SyncApi.Payload(Day).GetRawText())!;
        withCardio["cardio_done"] = true;
        withCardio["cardio_minutes"] = 30;
        await SyncApi.PushAsync(api.Client, new SyncChange(SyncApi.Entity, id, SyncOp.Upsert, JsonSerializer.SerializeToElement(withCardio), SyncApi.Past(30)));

        // Last write wins over the whole payload: an old client that does not know the fields sets them to null.
        var result = await SyncApi.PushOneAsync(api.Client, SyncApi.Checkin(id, Day, SyncApi.Past(10)));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var payload = (await SyncApi.PullAllAsync(api.Client)).Single(r => r.Id == id).Payload!.Value;
        Assert.Equal(JsonValueKind.Null, payload.GetProperty("cardio_done").ValueKind);
        Assert.Equal(JsonValueKind.Null, payload.GetProperty("cardio_minutes").ValueKind);
    }
}
