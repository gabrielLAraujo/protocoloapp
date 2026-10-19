using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Plans;

[Collection("api")]
public sealed class PlanActivationTests(ApiFactory factory)
{
    private static Task<List<PlanVersion>> PlansOfAsync(PlanApi api, PlanKind kind) =>
        api.WithDbAsync(db => db.PlanVersions.AsNoTracking().Where(p => p.UserId == api.UserId && p.Kind == kind).OrderBy(p => p.Version).ToListAsync());

    private static Task<List<Exercise>> ExercisesOfAsync(PlanApi api) =>
        api.WithDbAsync(db => db.Exercises.AsNoTracking().Where(e => e.UserId == api.UserId).ToListAsync());

    private static async Task<JsonElement> ProblemErrorsAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");

    [Fact]
    public async Task Put_on_an_active_plan_returns_409()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync();
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id)).StatusCode);

        var response = await api.PutAsync(draft.Id, PlanSamples.Workout);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Put_saves_the_edited_draft_and_rejects_unreadable_documents()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync();
        const string Edited = """{"rotation":{"type":"sequence","items":["x"]},"days":[{"key":"x","name":"Só um dia","exercises":[]}]}""";

        var ok = await api.PutAsync(draft.Id, Edited, [new NewExerciseSuggestion("Rosca Scott", MuscleGroup.Biceps)]);
        var bad = await api.PutAsync(draft.Id, """{"days":[{"key":"x","name":"d","exercises":[{"key":"e","name":"n","sets":[{"repsMin":"oito","repsMax":10}]}]}]}""");
        var notAnObject = await api.PutAsync(draft.Id, "[]");

        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, notAnObject.StatusCode);
        var reloaded = await api.GetAsync(draft.Id);
        Assert.Equal("Só um dia", reloaded.Document.GetProperty("days")[0].GetProperty("name").GetString());
        Assert.Equal("Rosca Scott", Assert.Single(reloaded.NewExercises).Name);
    }

    [Fact]
    public async Task Activate_archives_the_previous_active_plan_and_keeps_one_active_per_kind()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var first = await api.ImportDraftAsync();
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(first.Id)).StatusCode);
        var firstActive = Assert.Single(await PlansOfAsync(api, PlanKind.Workout));
        var second = await api.ImportDraftAsync();
        var protocol = await api.ImportDraftAsync(PlanKind.Protocol);
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(protocol.Id)).StatusCode);

        var response = await api.ActivateAsync(second.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<PlanVersionResponse>(PlanApi.Json))!;
        Assert.Equal(PlanStatus.Active, body.Status);
        Assert.NotNull(body.ActivatedAt);
        var workouts = await PlansOfAsync(api, PlanKind.Workout);
        Assert.Equal(PlanStatus.Archived, workouts.Single(p => p.Id == first.Id).Status);
        Assert.Equal(PlanStatus.Active, workouts.Single(p => p.Id == second.Id).Status);
        Assert.Equal(1, workouts.Count(p => p.Status == PlanStatus.Active));
        // The archived row was stamped: pull sees the change.
        Assert.True(workouts.Single(p => p.Id == first.Id).Version > firstActive.Version);
        // The protocol (other kind) is untouched.
        Assert.Equal(PlanStatus.Active, Assert.Single(await PlansOfAsync(api, PlanKind.Protocol)).Status);
    }

    [Fact]
    public async Task Activate_twice_is_idempotent()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync();
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id)).StatusCode);
        var before = Assert.Single(await PlansOfAsync(api, PlanKind.Workout));
        var exercisesBefore = await ExercisesOfAsync(api);

        var again = await api.ActivateAsync(draft.Id, new DateOnly(2026, 12, 1));

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var after = Assert.Single(await PlansOfAsync(api, PlanKind.Workout));
        Assert.Equal(before.Version, after.Version);
        Assert.Equal(before.ActivatedAt, after.ActivatedAt);
        Assert.Equal(exercisesBefore.Count, (await ExercisesOfAsync(api)).Count);
    }

    [Fact]
    public async Task Activate_creates_new_exercises_and_reuses_existing_ones_by_normalized_name()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var existing = Guid.NewGuid();
        await api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            db.Exercises.Add(new Exercise
            {
                Id = existing, UserId = api.UserId, Name = "supino inclinado halteres", NormalizedName = "supino inclinado halteres",
                PrimaryMuscleGroup = MuscleGroup.Chest, Version = 1, CreatedAt = now, UpdatedAt = now, ClientUpdatedAt = now,
            });
            await db.SaveChangesAsync();
            return 0;
        });
        factory.Extractor.Handler = (_, _, _, _) => Task.FromResult(FakePlanExtractor.Success(
            PlanSamples.Workout, [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back)]));
        var draft = await api.ImportDraftAsync();

        var response = await api.ActivateAsync(draft.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var exercises = await ExercisesOfAsync(api);
        Assert.Equal(2, exercises.Count);
        var created = exercises.Single(e => e.Id != existing);
        Assert.Equal(("Remada Curvada", "remada curvada", MuscleGroup.Back), (created.Name, created.NormalizedName, created.PrimaryMuscleGroup));
        Assert.True(created.Version > 0);
        var active = await api.GetAsync(draft.Id);
        var days = active.Document.GetProperty("days");
        Assert.Equal(existing, days[0].GetProperty("exercises")[0].GetProperty("exerciseId").GetGuid());
        Assert.Equal(created.Id, days[1].GetProperty("exercises")[0].GetProperty("exerciseId").GetGuid());
        Assert.Empty(active.NewExercises);
    }

    [Fact]
    public async Task Activate_matches_an_alias_and_restores_a_removed_exercise()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var aliased = Guid.NewGuid();
        var removed = Guid.NewGuid();
        await api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            db.Exercises.Add(new Exercise
            {
                Id = aliased, UserId = api.UserId, Name = "Supino 30 graus", NormalizedName = "supino 30 graus",
                Aliases = ["Supino inclinado c/ halteres"], Version = 1, CreatedAt = now, UpdatedAt = now, ClientUpdatedAt = now,
            });
            db.Exercises.Add(new Exercise
            {
                Id = removed, UserId = api.UserId, Name = "Remada curvada", NormalizedName = "remada curvada",
                DeletedAt = now, Version = 2, CreatedAt = now, UpdatedAt = now, ClientUpdatedAt = now,
            });
            await db.SaveChangesAsync();
            return 0;
        });
        var draft = await api.ImportDraftAsync();

        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id)).StatusCode);

        var exercises = await ExercisesOfAsync(api);
        Assert.Equal(2, exercises.Count);
        var restored = exercises.Single(e => e.Id == removed);
        Assert.Null(restored.DeletedAt);
        Assert.True(restored.Version > 2);
        var days = (await api.GetAsync(draft.Id)).Document.GetProperty("days");
        Assert.Equal(aliased, days[0].GetProperty("exercises")[0].GetProperty("exerciseId").GetGuid());
        Assert.Equal(removed, days[1].GetProperty("exercises")[0].GetProperty("exerciseId").GetGuid());
    }

    [Fact]
    public async Task Activate_stamps_sync_versions_on_every_changed_row()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync();

        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id)).StatusCode);

        var records = await SyncApi.PullAllAsync(api.Client);
        var plan = Assert.Single(records, r => r.Entity == "plan_version");
        Assert.Equal("active", plan.Payload!.Value.GetProperty("status").GetString());
        Assert.Equal(2, records.Count(r => r.Entity == "exercise"));
    }

    [Fact]
    public async Task Activate_refuses_an_empty_rotation_and_an_unknown_day_with_the_path()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync();
        const string Day = """{"key":"a","name":"A","exercises":[{"key":"e","name":"Supino","sets":[{"repsMin":8,"repsMax":10}]}]}""";

        Assert.Equal(HttpStatusCode.OK, (await api.PutAsync(draft.Id, $$"""{"rotation":{"type":"sequence","items":[]},"days":[{{Day}}]}""")).StatusCode);
        var empty = await api.ActivateAsync(draft.Id);
        Assert.Equal(HttpStatusCode.OK, (await api.PutAsync(draft.Id, $$"""{"rotation":{"type":"sequence","items":["a","zzz"]},"days":[{{Day}}]}""")).StatusCode);
        var unknown = await api.ActivateAsync(draft.Id);

        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.True((await ProblemErrorsAsync(empty)).TryGetProperty("rotation.items", out _));
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.True((await ProblemErrorsAsync(unknown)).TryGetProperty("rotation.items", out _));
        Assert.Equal(PlanStatus.Draft, (await api.GetAsync(draft.Id)).Status);
        Assert.Empty(await PlansOfActiveAsync(api));
    }

    [Fact]
    public async Task Activate_refuses_an_unusable_exercise_name_and_an_unknown_exercise_id_and_changes_nothing()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync();
        var ghost = Guid.NewGuid();
        var document = $$"""
            {"rotation":{"type":"sequence","items":["a"]},"days":[{"key":"a","name":"A","exercises":[
              {"key":"e1","name":"!!!","sets":[{"repsMin":8,"repsMax":10}]},
              {"key":"e2","name":"Supino","exerciseId":"{{ghost}}","sets":[{"repsMin":8,"repsMax":10}]},
              {"key":"e3","name":"Rosca direta","sets":[{"repsMin":8,"repsMax":10}]}]}]}
            """;
        Assert.Equal(HttpStatusCode.OK, (await api.PutAsync(draft.Id, document)).StatusCode);

        var response = await api.ActivateAsync(draft.Id);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ProblemErrorsAsync(response);
        Assert.True(errors.TryGetProperty("days[0].exercises[0].name", out _));
        Assert.True(errors.TryGetProperty("days[0].exercises[1].exerciseId", out _));
        Assert.Empty(await ExercisesOfAsync(api));
        Assert.Equal(PlanStatus.Draft, (await api.GetAsync(draft.Id)).Status);
    }

    [Fact]
    public async Task Activate_uses_the_cycle_start_as_local_midnight_in_utc()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync(PlanKind.Protocol);

        var response = await api.ActivateAsync(draft.Id, new DateOnly(2026, 10, 1));

        var body = (await response.Content.ReadFromJsonAsync<PlanVersionResponse>(PlanApi.Json))!;
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 3, 0, 0, TimeSpan.Zero), body.ActivatedAt);
    }

    [Fact]
    public async Task Activating_an_archived_version_returns_409()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var first = await api.ImportDraftAsync();
        await api.ActivateAsync(first.Id);
        var second = await api.ImportDraftAsync();
        await api.ActivateAsync(second.Id);

        Assert.Equal(HttpStatusCode.Conflict, (await api.ActivateAsync(first.Id)).StatusCode);
    }

    private static Task<List<PlanVersion>> PlansOfActiveAsync(PlanApi api) =>
        api.WithDbAsync(db => db.PlanVersions.AsNoTracking().Where(p => p.UserId == api.UserId && p.Status == PlanStatus.Active).ToListAsync());
}
