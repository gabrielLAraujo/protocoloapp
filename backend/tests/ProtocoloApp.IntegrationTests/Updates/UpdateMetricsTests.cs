using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Updates;

/// <summary><c>GET /api/update-cycles/{id}/metrics</c> over rows seeded through the real endpoints (fictitious data).</summary>
public sealed class UpdateMetricsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly string[] TopLevel =
    [
        "cycleId", "from", "to", "computedAt", "dietErrorPct", "dietWrongMeals", "dietDeviations", "missedWorkouts", "missedCardio",
        "itemsMissed", "strengthChanges", "trainingChanges", "weight", "waterAvg", "sleepAvg", "energyAvg", "anxietyAvg", "checkinNotes",
    ];

    private static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static DateOnly Today() => DateOnly.ParseExact(UpdateApi.LocalToday(), "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string Protocol(DateOnly updateDate) => $$"""
        {"phaseName":"Fase de exemplo","updateDate":"{{Iso(updateDate)}}",
         "meals":[
           {"key":"m1","label":"Refeição 1","items":[{"food":"Arroz","grams":100,"alternatives":[]}]},
           {"key":"m2","label":"Refeição 2","items":[{"food":"Feijão","grams":80,"alternatives":[]}]}],
         "items":[{"key":"creatine","category":"supplement","name":"Creatina","doseText":"5 g","timing":"any","schedule":{"type":"daily"}}],
         "guidelines":[{"kind":"water_min_l","value":3}]}
        """;

    private static JsonElement Json(params (string Key, object? Value)[] fields) =>
        JsonSerializer.SerializeToElement(fields.ToDictionary(f => f.Key, f => f.Value));

    private static SyncChange Upsert(string entity, JsonElement payload, Guid? id = null) =>
        new(entity, id ?? Guid.NewGuid(), SyncOp.Upsert, payload, SyncApi.Past(60));

    private static SyncChange Meal(DateOnly date, string key, string status, string? reason = null) =>
        Upsert("adherence_log", Json(
            ("date", Iso(date)), ("target_type", "meal"), ("target_key", key), ("status", status), ("reason", reason), ("note", null)));

    private static SyncChange Session(Guid id, DateOnly date, Guid planVersionId, string dayKey) =>
        Upsert("workout_session", Json(
            ("date", Iso(date)),
            ("plan_version_id", planVersionId),
            ("workout_day_key", dayKey),
            ("started_at", SyncApi.Past(90)),
            ("ended_at", SyncApi.Past(70)),
            ("note", null)), id);

    private static SyncChange Set(Guid sessionId, Guid exerciseId, int index, decimal weight, int reps, string kind = "normal") =>
        Upsert("set_log", Json(
            ("session_id", sessionId),
            ("exercise_id", exerciseId),
            ("planned_exercise_key", "bench"),
            ("set_index", index),
            ("weight_kg", weight),
            ("reps", reps),
            ("kind", kind),
            ("parent_set_id", null),
            ("completed_at", SyncApi.Past(80))));

    private static SyncChange Deviation(DateOnly date) =>
        Upsert("diet_deviation", Json(
            ("date", Iso(date)), ("meal_key", "m2"), ("time", null), ("description", "Biscoito de exemplo"), ("quantity", "2 unidades")));

    private static async Task<JsonElement> MetricsAsync(HttpClient client, Guid cycleId)
    {
        var response = await client.GetAsync(new Uri($"/api/update-cycles/{cycleId}/metrics", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.Clone();
    }

    private static void AssertProperties(JsonElement element, params string[] names) =>
        Assert.Equal(names.Order(StringComparer.Ordinal), element.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));

    [Fact]
    public async Task Metrics_of_a_seeded_cycle()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var today = Today();
        var start = today.AddDays(-6);

        // Protocol and workout plan both start on the first day of the cycle; rotation a, b, off from there.
        var protocol = await api.ImportDraftAsync(PlanKind.Protocol);
        Assert.Equal(HttpStatusCode.OK, (await api.PutAsync(protocol.Id, Protocol(today.AddDays(30)))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(protocol.Id, start)).StatusCode);
        var workout = await api.ImportDraftAsync();
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(workout.Id, start)).StatusCode);
        var bench = await api.WithDbAsync(db => db.Exercises.AsNoTracking()
            .SingleAsync(e => e.UserId == api.UserId && e.Name == "Rosca Alternada C/ Halteres"));
        var cycle = await UpdateApi.SingleCycleAsync(api.Client);
        Assert.Equal(Iso(start), UpdateApi.Date(cycle.Payload!.Value, "period_start"));

        var changes = new List<SyncChange>();
        // Six past days × 2 meals: m1 always done; m2 done on 4, partial on 1, unmarked on 1. Today is left unmarked.
        for (var i = 0; i < 6; i++)
        {
            var date = start.AddDays(i);
            changes.Add(Meal(date, "m1", "done"));
            if (i < 4)
                changes.Add(Meal(date, "m2", "done"));
            else if (i == 4)
                changes.Add(Meal(date, "m2", "partial", "no_time"));
        }

        changes.Add(Deviation(start.AddDays(2)));

        // Day a on start and start+3: e1RM 60 × (1 + 10/30) = 80, then 70 × (1 + 10/30) = 93.33. The warm-up is ignored.
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        changes.Add(Session(first, start, workout.Id, "a"));
        changes.Add(Set(first, bench.Id, 0, 40m, 10, "warmup"));
        changes.Add(Set(first, bench.Id, 1, 60m, 10));
        changes.Add(Session(second, start.AddDays(3), workout.Id, "a"));
        changes.Add(Set(second, bench.Id, 0, 70m, 10));

        changes.Add(SyncApi.Checkin(Guid.NewGuid(), start, SyncApi.Past(60), weightKg: 80.4m, note: "Nota de exemplo."));
        changes.Add(SyncApi.Checkin(Guid.NewGuid(), start.AddDays(5), SyncApi.Past(60), weightKg: 79.9m, note: null));

        var results = await SyncApi.PushAsync(api.Client, [.. changes]);
        Assert.All(results, r => Assert.Equal(SyncResultStatus.Applied, r.Status));

        var metrics = await MetricsAsync(api.Client, cycle.Id);

        AssertProperties(metrics, TopLevel);
        Assert.Equal(cycle.Id, metrics.GetProperty("cycleId").GetGuid());
        Assert.Equal(Iso(start), metrics.GetProperty("from").GetString());
        Assert.Equal(Iso(today), metrics.GetProperty("to").GetString());

        // Diet: 12 planned meals + 1 deviation, 10 done → round(100 × 3 / 13) = 23.
        var diet = metrics.GetProperty("dietErrorPct");
        AssertProperties(diet, "cycle", "weeks");
        var rate = diet.GetProperty("cycle");
        AssertProperties(rate, "planned", "done", "errorPct");
        Assert.Equal(13, rate.GetProperty("planned").GetInt32());
        Assert.Equal(10, rate.GetProperty("done").GetInt32());
        Assert.Equal(23, rate.GetProperty("errorPct").GetInt32());
        var week = Assert.Single(diet.GetProperty("weeks").EnumerateArray());
        AssertProperties(week, "week", "from", "to", "planned", "done", "errorPct");
        Assert.Equal(1, week.GetProperty("week").GetInt32());

        var wrong = Assert.Single(metrics.GetProperty("dietWrongMeals").EnumerateArray());
        AssertProperties(wrong, "week", "from", "to", "count", "reasons");
        Assert.Equal(3, wrong.GetProperty("count").GetInt32());
        Assert.Equal(
            new[] { "deviation", "no_time", "unmarked" },
            wrong.GetProperty("reasons").EnumerateArray().Select(r => r.GetProperty("reason").GetString()).Order(StringComparer.Ordinal));

        var deviation = Assert.Single(metrics.GetProperty("dietDeviations").EnumerateArray());
        AssertProperties(deviation, "date", "mealKey", "mealLabel", "time", "description", "quantity");
        Assert.Equal("Refeição 2", deviation.GetProperty("mealLabel").GetString());

        // Training days before today: start, +1, +3, +4 (today is not counted without a workout).
        var workouts = metrics.GetProperty("missedWorkouts");
        AssertProperties(workouts, "planned", "done", "missedDates");
        Assert.Equal(4, workouts.GetProperty("planned").GetInt32());
        Assert.Equal(2, workouts.GetProperty("done").GetInt32());
        Assert.Equal(
            new[] { Iso(start.AddDays(1)), Iso(start.AddDays(4)) },
            workouts.GetProperty("missedDates").EnumerateArray().Select(d => d.GetString()));

        var cardio = metrics.GetProperty("missedCardio");
        AssertProperties(cardio, "planned", "done");
        Assert.Equal(0, cardio.GetProperty("planned").GetInt32());

        var item = Assert.Single(metrics.GetProperty("itemsMissed").EnumerateArray());
        AssertProperties(item, "key", "name", "missed", "reasons");
        Assert.Equal("creatine", item.GetProperty("key").GetString());
        Assert.Equal(6, item.GetProperty("missed").GetInt32());

        var group = Assert.Single(metrics.GetProperty("strengthChanges").EnumerateArray());
        AssertProperties(group, "group", "best", "worst");
        Assert.Equal(JsonNamingPolicy.CamelCase.ConvertName(bench.PrimaryMuscleGroup.ToString()), group.GetProperty("group").GetString());
        var trend = Assert.Single(group.GetProperty("best").EnumerateArray());
        AssertProperties(trend, "exerciseId", "name", "firstE1rm", "lastE1rm", "delta", "sessions");
        Assert.Equal(bench.Id, trend.GetProperty("exerciseId").GetGuid());
        Assert.Equal(80m, trend.GetProperty("firstE1rm").GetDecimal());
        Assert.Equal(93.33m, trend.GetProperty("lastE1rm").GetDecimal());
        Assert.Equal(13.33m, trend.GetProperty("delta").GetDecimal());
        Assert.Equal(2, trend.GetProperty("sessions").GetInt32());
        Assert.Empty(group.GetProperty("worst").EnumerateArray());

        var change = Assert.Single(metrics.GetProperty("trainingChanges").EnumerateArray());
        AssertProperties(change, "date", "kind", "exerciseName", "replacementName");
        Assert.Equal("plan_activated", change.GetProperty("kind").GetString());
        Assert.Equal(Iso(start), change.GetProperty("date").GetString());
        Assert.Equal("Treino A / Treino B", change.GetProperty("exerciseName").GetString());
        Assert.Equal(JsonValueKind.Null, change.GetProperty("replacementName").ValueKind);

        var weight = metrics.GetProperty("weight");
        AssertProperties(weight, "start", "end", "deltaKg");
        AssertProperties(weight.GetProperty("start"), "date", "kg");
        Assert.Equal(80.4m, weight.GetProperty("start").GetProperty("kg").GetDecimal());
        Assert.Equal(79.9m, weight.GetProperty("end").GetProperty("kg").GetDecimal());
        Assert.Equal(-0.5m, weight.GetProperty("deltaKg").GetDecimal());

        var water = metrics.GetProperty("waterAvg");
        AssertProperties(water, "avgL", "targetL", "days");
        Assert.Equal(2.5m, water.GetProperty("avgL").GetDecimal());
        Assert.Equal(3m, water.GetProperty("targetL").GetDecimal());
        Assert.Equal(2, water.GetProperty("days").GetInt32());
        AssertProperties(metrics.GetProperty("sleepAvg"), "avg", "days");
        AssertProperties(metrics.GetProperty("energyAvg"), "wake", "day");
        Assert.Equal(3m, metrics.GetProperty("energyAvg").GetProperty("wake").GetProperty("avg").GetDecimal());
        Assert.Equal(2m, metrics.GetProperty("anxietyAvg").GetProperty("avg").GetDecimal());

        var note = Assert.Single(metrics.GetProperty("checkinNotes").EnumerateArray());
        AssertProperties(note, "date", "note");
        Assert.Equal(Iso(start), note.GetProperty("date").GetString());
        Assert.Equal("Nota de exemplo.", note.GetProperty("note").GetString());
    }

    [Fact]
    public async Task A_cycle_opened_today_has_empty_metrics()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await UpdateApi.ActivateProtocolAsync(api, Protocol(Today().AddDays(30)));
        var cycle = await UpdateApi.SingleCycleAsync(api.Client);

        var metrics = await MetricsAsync(api.Client, cycle.Id);

        AssertProperties(metrics, TopLevel);
        var rate = metrics.GetProperty("dietErrorPct").GetProperty("cycle");
        Assert.Equal(0, rate.GetProperty("planned").GetInt32());
        Assert.Equal(JsonValueKind.Null, rate.GetProperty("errorPct").ValueKind);
        Assert.Empty(metrics.GetProperty("dietErrorPct").GetProperty("weeks").EnumerateArray());
        foreach (var list in new[] { "dietWrongMeals", "dietDeviations", "itemsMissed", "strengthChanges", "trainingChanges", "checkinNotes" })
            Assert.Empty(metrics.GetProperty(list).EnumerateArray());
        Assert.Equal(0, metrics.GetProperty("missedWorkouts").GetProperty("planned").GetInt32());
        Assert.Equal(JsonValueKind.Null, metrics.GetProperty("weight").GetProperty("start").ValueKind);
        Assert.Equal(JsonValueKind.Null, metrics.GetProperty("weight").GetProperty("deltaKg").ValueKind);
        Assert.Equal(JsonValueKind.Null, metrics.GetProperty("waterAvg").GetProperty("avgL").ValueKind);
        Assert.Equal(JsonValueKind.Null, metrics.GetProperty("sleepAvg").GetProperty("avg").ValueKind);
        Assert.Equal(0, metrics.GetProperty("sleepAvg").GetProperty("days").GetInt32());
        Assert.Equal(JsonValueKind.Null, metrics.GetProperty("energyAvg").GetProperty("day").GetProperty("avg").ValueKind);
        Assert.Equal(JsonValueKind.Null, metrics.GetProperty("anxietyAvg").GetProperty("avg").ValueKind);
    }

    [Fact]
    public async Task Another_users_or_an_unknown_cycle_is_not_found()
    {
        using var owner = await PlanApi.CreateAsync(factory);
        await UpdateApi.ActivateProtocolAsync(owner, Protocol(Today().AddDays(30)));
        var cycle = await UpdateApi.SingleCycleAsync(owner.Client);
        using var other = await PlanApi.CreateAsync(factory);

        var foreign = await other.Client.GetAsync(new Uri($"/api/update-cycles/{cycle.Id}/metrics", UriKind.Relative));
        var unknown = await owner.Client.GetAsync(new Uri($"/api/update-cycles/{Guid.NewGuid()}/metrics", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
    }
}
