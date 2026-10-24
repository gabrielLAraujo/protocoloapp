using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Integrations.Hevy;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Features.Today;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Integrations;

// The importer against a real database, with fictitious Hevy workouts (made-up titles, round loads).
public sealed class HevyImporterTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo");

    // 23:30 in São Paulo on March 10 (02:30 UTC on the 11th): the session belongs to the 10th.
    private static readonly DateTimeOffset Start = new(2026, 3, 11, 2, 30, 0, TimeSpan.Zero);
    private static readonly DateOnly LocalDay = new(2026, 3, 10);
    private static readonly DateTimeOffset Edited = new(2026, 3, 11, 4, 0, 0, TimeSpan.Zero);

    private const string MatchedTemplate = "TPL-TEST-01";
    private const string UnknownTemplate = "TPL-TEST-99";

    private sealed record Setup(PlanApi Api, Guid PlanVersionId, Guid CurlId);

    private async Task<Setup> NewUserAsync()
    {
        var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync();
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id)).StatusCode);
        // The workouts below are in March: the plan was active since the 1st.
        await api.WithDbAsync(async db =>
        {
            var plan = await db.PlanVersions.SingleAsync(p => p.Id == draft.Id);
            plan.ActivatedAt = new DateTimeOffset(2026, 3, 1, 12, 0, 0, TimeSpan.Zero);
            return await db.SaveChangesAsync();
        });
        var curl = await api.WithDbAsync(db => db.Exercises.AsNoTracking()
            .SingleAsync(e => e.UserId == api.UserId && e.NormalizedName == ExerciseNames.Normalize("Rosca Alternada C/ Halteres")));
        return new Setup(api, draft.Id, curl.Id);
    }

    private static ImportContext Context(DateOnly? syncFrom = null) =>
        new(syncFrom ?? new DateOnly(2026, 3, 1), Zone, TimeProvider.System, _ => Task.FromResult<string?>("biceps"));

    private static HevySet Set(int index, string type, decimal? weight, int? reps, decimal? rpe = null, int? duration = null) =>
        new(index, type, weight, reps, null, duration, rpe);

    private static HevyWorkout Workout(string id, DateTimeOffset updatedAt, bool shorter = false, DateTimeOffset? start = null)
    {
        HevySet[] curlSets = shorter
            ? [Set(0, "warmup", 10m, 15), Set(1, "normal", 20m, 10, 8m)]
            : [Set(0, "warmup", 10m, 15), Set(1, "normal", 20m, 10, 8m), Set(2, "dropset", 14m, 8)];
        var begin = start ?? Start;
        return new HevyWorkout(id, "Treino A", "Nota inventada", begin, begin.AddHours(1), updatedAt,
        [
            new HevyExercise("Rosca Alternada (Halteres)", MatchedTemplate, null, null, curlSets),
            new HevyExercise("Exercicio Inventado Hevy", UnknownTemplate, null, null, [Set(0, "normal", 30m, 12)]),
            new HevyExercise("Esteira Inventada", "TPL-TEST-50", null, null, [Set(0, "normal", null, null, duration: 600)]),
        ]);
    }

    private static string NewId() => $"hevy-test-{Guid.NewGuid():N}";

    private async Task<ImportOutcome> ImportAsync(Guid userId, HevyWorkout w, ImportContext? ctx = null)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await HevyImporter.ApplyUpdatedAsync(db, userId, w, ctx ?? Context(), CancellationToken.None);
    }

    private async Task<ImportOutcome> DeleteAsync(Guid userId, string externalId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await HevyImporter.ApplyDeletedAsync(db, userId, externalId, Context(), CancellationToken.None);
    }

    private static Task<Counts> CountAsync(PlanApi api) => api.WithDbAsync(async db => new Counts(
        await db.WorkoutSessions.CountAsync(s => s.UserId == api.UserId),
        await db.SetLogs.CountAsync(s => s.UserId == api.UserId),
        await db.AdherenceLogs.CountAsync(a => a.UserId == api.UserId),
        await db.Exercises.CountAsync(e => e.UserId == api.UserId),
        await db.HevyExerciseLinks.CountAsync(l => l.UserId == api.UserId)));

    private sealed record Counts(int Sessions, int Sets, int Marks, int Exercises, int Links);

    private static Guid MarkId(Guid userId, DateOnly date) => AdherenceIds.For(userId, date, "workout", "workout");

    [Fact]
    public async Task Imports_a_finished_session_with_sets_and_the_workout_mark_and_devices_pull_them()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var ctx = Context();

        var outcome = ctx.Count(await ImportAsync(api.UserId, Workout(NewId(), Edited), ctx));

        Assert.Equal(ImportOutcome.Imported, outcome);
        Assert.Equal(1, ctx.SkippedSets);
        var pending = await api.WithDbAsync(db => HevyImporter.PendingExercisesAsync(db, api.UserId, CancellationToken.None));
        Assert.Equal(new HevySyncResult(1, 0, 0, 0, 0, 1, 1), ctx.ToResult(pending));
        var records = await SyncApi.PullAllAsync(api.Client);
        var session = Assert.Single(records, r => r.Entity == "workout_session");
        var payload = session.Payload!.Value;
        Assert.Equal("hevy", payload.GetProperty("source").GetString());
        Assert.Equal("Treino A", payload.GetProperty("external_title").GetString());
        Assert.Equal("2026-03-10", payload.GetProperty("date").GetString());
        Assert.Equal("a", payload.GetProperty("workout_day_key").GetString());
        Assert.Equal(s.PlanVersionId, payload.GetProperty("plan_version_id").GetGuid());
        Assert.Equal("Nota inventada", payload.GetProperty("note").GetString());
        Assert.NotEqual(JsonValueKind.Null, payload.GetProperty("ended_at").ValueKind);

        var sets = records.Where(r => r.Entity == "set_log").Select(r => r.Payload!.Value).ToList();
        Assert.Equal(4, sets.Count);
        Assert.All(sets, p => Assert.Equal(session.Id, p.GetProperty("session_id").GetGuid()));
        var curl = sets.Where(p => p.GetProperty("exercise_id").GetGuid() == s.CurlId).ToList();
        Assert.Equal(new[] { "warmup", "normal", "drop" }, curl.OrderBy(p => p.GetProperty("completed_at").GetDateTimeOffset()).Select(p => p.GetProperty("kind").GetString()));
        Assert.All(curl, p => Assert.Equal("bench", p.GetProperty("planned_exercise_key").GetString()));
        Assert.Contains(curl, p => p.GetProperty("rpe").ValueKind == JsonValueKind.Number && p.GetProperty("rpe").GetDecimal() == 8m);
        var extra = Assert.Single(sets, p => p.GetProperty("exercise_id").GetGuid() != s.CurlId);
        Assert.Equal(JsonValueKind.Null, extra.GetProperty("planned_exercise_key").ValueKind);

        var mark = Assert.Single(records, r => r.Entity == "adherence_log");
        Assert.Equal(MarkId(api.UserId, LocalDay), mark.Id);
        Assert.Equal("done", mark.Payload!.Value.GetProperty("status").GetString());
        Assert.Equal("2026-03-10", mark.Payload!.Value.GetProperty("date").GetString());
        Assert.Contains(records, r => r.Entity == "exercise" && r.Payload!.Value.GetProperty("name").GetString() == "Exercicio Inventado Hevy");
    }

    [Fact]
    public async Task The_same_updated_at_again_is_unchanged_and_writes_nothing()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var id = NewId();
        await ImportAsync(api.UserId, Workout(id, Edited));
        var before = await CountAsync(api);
        var lastVersion = (await SyncApi.PullAllAsync(api.Client)).Max(r => r.Version);

        var again = await ImportAsync(api.UserId, Workout(id, Edited));
        var older = await ImportAsync(api.UserId, Workout(id, Edited.AddMinutes(-5)));

        Assert.Equal(ImportOutcome.Unchanged, again);
        Assert.Equal(ImportOutcome.Unchanged, older);
        Assert.Equal(before, await CountAsync(api));
        Assert.Equal(lastVersion, (await SyncApi.PullAllAsync(api.Client)).Max(r => r.Version));
    }

    [Fact]
    public async Task A_newer_updated_at_replaces_the_sets_and_keeps_the_session_id()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var id = NewId();
        await ImportAsync(api.UserId, Workout(id, Edited));
        var first = await api.WithDbAsync(db => db.WorkoutSessions.AsNoTracking().SingleAsync(x => x.UserId == api.UserId));

        var outcome = await ImportAsync(api.UserId, Workout(id, Edited.AddMinutes(10), shorter: true));

        Assert.Equal(ImportOutcome.Updated, outcome);
        var sessions = await api.WithDbAsync(db => db.WorkoutSessions.AsNoTracking().Where(x => x.UserId == api.UserId).ToListAsync());
        var session = Assert.Single(sessions);
        Assert.Equal(first.Id, session.Id);
        Assert.True(session.Version > first.Version);
        var sets = await api.WithDbAsync(db => db.SetLogs.AsNoTracking().Where(x => x.SessionId == session.Id).ToListAsync());
        Assert.Equal(4, sets.Count(x => x.DeletedAt != null));
        Assert.Equal(3, sets.Count(x => x.DeletedAt == null));
        Assert.Equal(1, await api.WithDbAsync(db => db.AdherenceLogs.CountAsync(a => a.UserId == api.UserId && a.DeletedAt == null)));
    }

    [Fact]
    public async Task Deleted_in_hevy_soft_deletes_the_session_its_sets_and_clears_the_mark()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var id = NewId();
        await ImportAsync(api.UserId, Workout(id, Edited));

        var outcome = await DeleteAsync(api.UserId, id);
        var again = await DeleteAsync(api.UserId, id);
        var unknown = await DeleteAsync(api.UserId, NewId());

        Assert.Equal(ImportOutcome.Deleted, outcome);
        Assert.Equal(ImportOutcome.Unchanged, again);
        Assert.Equal(ImportOutcome.Unchanged, unknown);
        var records = await SyncApi.PullAllAsync(api.Client);
        Assert.All(records.Where(r => r.Entity is "workout_session" or "set_log"), r => Assert.NotNull(r.DeletedAt));
        var mark = Assert.Single(records, r => r.Entity == "adherence_log");
        Assert.NotNull(mark.DeletedAt);
    }

    [Fact]
    public async Task A_session_deleted_in_the_app_is_not_brought_back()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var id = NewId();
        await ImportAsync(api.UserId, Workout(id, Edited));
        var session = await api.WithDbAsync(db => db.WorkoutSessions.AsNoTracking().SingleAsync(x => x.UserId == api.UserId));
        var deleted = await SyncApi.PushOneAsync(api.Client, new SyncChange("workout_session", session.Id, SyncOp.Delete, null, DateTimeOffset.UtcNow.AddSeconds(1)));
        Assert.Equal(SyncResultStatus.Applied, deleted.Status);
        var before = await CountAsync(api);
        var lastVersion = (await SyncApi.PullAllAsync(api.Client)).Max(r => r.Version);

        var outcome = await ImportAsync(api.UserId, Workout(id, Edited.AddHours(1), shorter: true));

        Assert.Equal(ImportOutcome.Dismissed, outcome);
        Assert.Equal(before, await CountAsync(api));
        Assert.Equal(lastVersion, (await SyncApi.PullAllAsync(api.Client)).Max(r => r.Version));
        var stored = await api.WithDbAsync(db => db.WorkoutSessions.AsNoTracking().SingleAsync(x => x.Id == session.Id));
        Assert.NotNull(stored.DeletedAt);
    }

    [Fact]
    public async Task An_unmatched_exercise_becomes_a_provisional_one_with_a_pending_link()
    {
        var s = await NewUserAsync();
        using var api = s.Api;

        await ImportAsync(api.UserId, Workout(NewId(), Edited));

        var link = await api.WithDbAsync(db => db.HevyExerciseLinks.AsNoTracking().SingleAsync(l => l.UserId == api.UserId && l.TemplateId == UnknownTemplate));
        Assert.Equal(HevyLinkStatus.Pending, link.Status);
        Assert.True(link.CreatedExercise);
        Assert.Equal("Exercicio Inventado Hevy", link.Title);
        var exercise = await api.WithDbAsync(db => db.Exercises.AsNoTracking().SingleAsync(e => e.Id == link.ExerciseId));
        Assert.Equal("Exercicio Inventado Hevy", exercise.Name);
        Assert.Equal(MuscleGroup.Biceps, exercise.PrimaryMuscleGroup);
        Assert.True(exercise.Version > 0);
        var sets = await api.WithDbAsync(db => db.SetLogs.AsNoTracking().Where(x => x.ExerciseId == link.ExerciseId).ToListAsync());
        Assert.All(sets, x => Assert.Equal(UnknownTemplate, x.HevyTemplateId));
        // A second workout with the same template reuses the link and the exercise.
        await ImportAsync(api.UserId, Workout(NewId(), Edited, start: Start.AddDays(2)));
        Assert.Equal(1, await api.WithDbAsync(db => db.HevyExerciseLinks.CountAsync(l => l.UserId == api.UserId && l.TemplateId == UnknownTemplate)));
        Assert.Equal(2, await api.WithDbAsync(db => db.SetLogs.CountAsync(x => x.ExerciseId == link.ExerciseId)));
    }

    [Fact]
    public async Task An_exact_match_links_to_the_users_exercise_automatically()
    {
        var s = await NewUserAsync();
        using var api = s.Api;

        await ImportAsync(api.UserId, Workout(NewId(), Edited));

        var link = await api.WithDbAsync(db => db.HevyExerciseLinks.AsNoTracking().SingleAsync(l => l.UserId == api.UserId && l.TemplateId == MatchedTemplate));
        Assert.Equal(HevyLinkStatus.Auto, link.Status);
        Assert.False(link.CreatedExercise);
        Assert.Equal(s.CurlId, link.ExerciseId);
        // The duration-only exercise is not linked.
        Assert.Equal(2, await api.WithDbAsync(db => db.HevyExerciseLinks.CountAsync(l => l.UserId == api.UserId)));
    }

    [Fact]
    public async Task Without_a_plan_on_the_date_nothing_is_imported()
    {
        using var api = await PlanApi.CreateAsync(factory);

        var outcome = await ImportAsync(api.UserId, Workout(NewId(), Edited));

        Assert.Equal(ImportOutcome.SkippedNoPlan, outcome);
        Assert.Equal(new Counts(0, 0, 0, 0, 0), await CountAsync(api));
    }

    [Fact]
    public async Task A_workout_before_sync_from_is_ignored()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var before = await CountAsync(api);

        var outcome = await ImportAsync(api.UserId, Workout(NewId(), Edited), Context(new DateOnly(2026, 3, 11)));

        Assert.Equal(ImportOutcome.SkippedBeforeSyncFrom, outcome);
        Assert.Equal(before, await CountAsync(api));
    }

    [Fact]
    public async Task A_device_mark_of_the_date_becomes_done()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        var markId = MarkId(api.UserId, LocalDay);
        var missed = new SyncChange("adherence_log", markId, SyncOp.Upsert, JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["date"] = "2026-03-10",
            ["target_type"] = "workout",
            ["target_key"] = "workout",
            ["status"] = "missed",
            ["reason"] = "no_time",
            ["note"] = null,
        }), SyncApi.Past(30));
        Assert.Equal(SyncResultStatus.Applied, (await SyncApi.PushOneAsync(api.Client, missed)).Status);

        await ImportAsync(api.UserId, Workout(NewId(), Edited));

        var marks = await api.WithDbAsync(db => db.AdherenceLogs.AsNoTracking().Where(a => a.UserId == api.UserId).ToListAsync());
        var mark = Assert.Single(marks);
        Assert.Equal(markId, mark.Id);
        Assert.Equal(AdherenceStatus.Done, mark.Status);
        Assert.Null(mark.Reason);
    }

    [Fact]
    public async Task Template_groups_are_asked_outside_the_write_transaction_and_only_for_new_exercises()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var asked = new List<(string TemplateId, bool InTransaction)>();
        var ctx = new ImportContext(new DateOnly(2026, 3, 1), Zone, TimeProvider.System, templateId =>
        {
            asked.Add((templateId, db.Database.CurrentTransaction is not null));
            return Task.FromResult<string?>("biceps");
        });

        var outcome = await HevyImporter.ApplyUpdatedAsync(db, api.UserId, Workout(NewId(), Edited), ctx, CancellationToken.None);

        Assert.Equal(ImportOutcome.Imported, outcome);
        // The matched curl needs no group; the unknown template is asked once, with no transaction (nor user lock) open.
        Assert.Equal(new[] { (UnknownTemplate, false) }, asked);
        var link = await api.WithDbAsync(d => d.HevyExerciseLinks.AsNoTracking().SingleAsync(l => l.UserId == api.UserId && l.TemplateId == UnknownTemplate));
        Assert.Equal(MuscleGroup.Biceps, (await api.WithDbAsync(d => d.Exercises.AsNoTracking().SingleAsync(e => e.Id == link.ExerciseId))).PrimaryMuscleGroup);
    }

    [Fact]
    public async Task A_workout_with_no_plan_day_to_go_to_creates_no_exercise_nor_link()
    {
        var s = await NewUserAsync();
        using var api = s.Api;
        // The active plan has no day at all: the resolver finds nowhere to put the workout.
        await api.WithDbAsync(async db =>
        {
            var plan = await db.PlanVersions.SingleAsync(p => p.Id == s.PlanVersionId);
            var copy = System.Text.Json.Nodes.JsonNode.Parse(plan.Document.RootElement.GetRawText())!.AsObject();
            copy["days"] = new System.Text.Json.Nodes.JsonArray();
            plan.Document = JsonDocument.Parse(copy.ToJsonString());
            return await db.SaveChangesAsync();
        });
        var before = await CountAsync(api);

        var outcome = await ImportAsync(api.UserId, Workout(NewId(), Edited));

        Assert.Equal(ImportOutcome.SkippedNoPlan, outcome);
        Assert.Equal(before, await CountAsync(api));
        Assert.False(await api.WithDbAsync(db => db.Exercises.AnyAsync(e => e.UserId == api.UserId && e.Name == "Exercicio Inventado Hevy")));
    }
}
