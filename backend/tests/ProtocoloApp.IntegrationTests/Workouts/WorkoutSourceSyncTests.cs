using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Features.Workouts;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Workouts;

// source / external_title (server-owned, pull only) and rpe (synced both ways) on the workout payloads.
public sealed class WorkoutSourceSyncTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateOnly Day = new(2026, 3, 10);

    private sealed record Setup(PlanApi Api, Guid PlanVersionId, Guid ExerciseId);

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

    private static SyncChange Session(Guid id, Guid planVersionId, string? note, int minutesAgo, params (string Key, object? Value)[] extra) =>
        new("workout_session", id, SyncOp.Upsert, Json(
            [
                ("date", Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)),
                ("plan_version_id", planVersionId),
                ("workout_day_key", "a"),
                ("started_at", SyncApi.Past(90)),
                ("ended_at", SyncApi.Past(70)),
                ("note", note),
                .. extra,
            ]), SyncApi.Past(minutesAgo));

    private static SyncChange Set(Guid id, Guid sessionId, Guid exerciseId, params (string Key, object? Value)[] extra) =>
        new("set_log", id, SyncOp.Upsert, Json(
            [
                ("session_id", sessionId),
                ("exercise_id", exerciseId),
                ("planned_exercise_key", "bench"),
                ("set_index", 0),
                ("weight_kg", 60m),
                ("reps", 10),
                ("kind", "normal"),
                ("parent_set_id", null),
                ("completed_at", SyncApi.Past(80)),
                .. extra,
            ]), SyncApi.Past(60));

    private static async Task<JsonElement> PulledAsync(HttpClient client, Guid id) =>
        (await SyncApi.PullAllAsync(client)).Last(r => r.Id == id).Payload!.Value;

    // What the importer will do: mark a stored session as imported from Hevy, with a new version so devices receive it.
    private static Task MarkAsHevyAsync(PlanApi api, Guid sessionId, string externalId, string title) =>
        api.WithDbAsync(async db =>
        {
            var session = await db.WorkoutSessions.SingleAsync(s => s.Id == sessionId);
            session.Source = SessionSource.Hevy;
            session.ExternalId = externalId;
            session.ExternalUpdatedAt = SyncApi.Past(75);
            session.ExternalTitle = title;
            session.Version = await SyncVersion.NextAsync(db);
            return await db.SaveChangesAsync();
        });

    [Fact]
    public async Task Pushed_source_and_external_title_are_ignored_and_pull_says_app()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var session = Guid.NewGuid();

        var result = await SyncApi.PushOneAsync(api.Client, Session(session, s.PlanVersionId, null, 60, ("source", "hevy"), ("external_title", "Treino Inventado")));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var payload = await PulledAsync(api.Client, session);
        Assert.Equal("app", payload.GetProperty("source").GetString());
        Assert.Equal(JsonValueKind.Null, payload.GetProperty("external_title").ValueKind);
    }

    [Fact]
    public async Task Session_without_the_new_fields_still_applies()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var session = Guid.NewGuid();
        var set = Guid.NewGuid();

        var results = await SyncApi.PushAsync(api.Client, Session(session, s.PlanVersionId, null, 60), Set(set, session, s.ExerciseId));

        Assert.All(results, r => Assert.Equal(SyncResultStatus.Applied, r.Status));
        Assert.Equal(JsonValueKind.Null, (await PulledAsync(api.Client, set)).GetProperty("rpe").ValueKind);
    }

    [Fact]
    public async Task Imported_session_is_pulled_with_source_and_title_and_a_later_push_keeps_them()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var session = Guid.NewGuid();
        await SyncApi.PushOneAsync(api.Client, Session(session, s.PlanVersionId, null, 60));
        await MarkAsHevyAsync(api, session, "hevy-test-0001", "Treino A Inventado");

        var pulled = await PulledAsync(api.Client, session);
        Assert.Equal("hevy", pulled.GetProperty("source").GetString());
        Assert.Equal("Treino A Inventado", pulled.GetProperty("external_title").GetString());

        // An older app version pushes the session back without the new fields; a newer one echoes other values.
        var older = await SyncApi.PushOneAsync(api.Client, Session(session, s.PlanVersionId, "nota", 30));
        var newer = await SyncApi.PushOneAsync(api.Client, Session(session, s.PlanVersionId, "nota 2", 20, ("source", "app"), ("external_title", "Outro")));

        Assert.Equal(SyncResultStatus.Applied, older.Status);
        Assert.Equal(SyncResultStatus.Applied, newer.Status);
        var after = await PulledAsync(api.Client, session);
        Assert.Equal("hevy", after.GetProperty("source").GetString());
        Assert.Equal("Treino A Inventado", after.GetProperty("external_title").GetString());
        Assert.Equal("nota 2", after.GetProperty("note").GetString());
        var stored = await api.WithDbAsync(db => db.WorkoutSessions.AsNoTracking().SingleAsync(x => x.Id == session));
        Assert.Equal("hevy-test-0001", stored.ExternalId);
    }

    [Fact]
    public async Task Rpe_round_trips_and_an_invalid_one_is_rejected()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var session = Guid.NewGuid();
        var set = Guid.NewGuid();

        var results = await SyncApi.PushAsync(api.Client, Session(session, s.PlanVersionId, null, 60), Set(set, session, s.ExerciseId, ("rpe", 8.5m)));
        var invalid = await SyncApi.PushOneAsync(api.Client, Set(Guid.NewGuid(), session, s.ExerciseId, ("rpe", 7.25m)));

        Assert.All(results, r => Assert.Equal(SyncResultStatus.Applied, r.Status));
        Assert.Equal(8.5m, (await PulledAsync(api.Client, set)).GetProperty("rpe").GetDecimal());
        Assert.Equal(SyncResultStatus.Rejected, invalid.Status);
        Assert.Equal(new[] { "invalid_payload:rpe" }, invalid.Errors);
    }

    [Fact]
    public async Task External_id_is_unique_per_user_and_source_even_when_the_session_is_deleted()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await SyncApi.PushAsync(api.Client, Session(first, s.PlanVersionId, null, 60), Session(second, s.PlanVersionId, null, 60));
        await MarkAsHevyAsync(api, first, "hevy-test-0002", "Treino B Inventado");
        await SyncApi.PushOneAsync(api.Client, new SyncChange("workout_session", first, SyncOp.Delete, null, SyncApi.Past(10)));

        await Assert.ThrowsAsync<DbUpdateException>(() => MarkAsHevyAsync(api, second, "hevy-test-0002", "Treino B Inventado"));
    }
}
