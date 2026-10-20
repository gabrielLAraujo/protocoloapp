using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.IntegrationTests.ExerciseCatalog;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Plans;

/// <summary><c>catalogId</c> on the new exercises of a draft, at activation, and the alias the activation learns.</summary>
[Collection("api")]
public sealed class PlanCatalogLinkTests(ApiFactory factory)
{
    private static async Task<JsonElement> ErrorsAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");

    private static async Task<Guid> CreatedIdAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CreateDraftResponse>(PlanApi.Json))!.PlanVersionId;
    }

    private static Task<Guid> AddExerciseAsync(PlanApi api, string name, params string[] aliases) => api.WithDbAsync(async db =>
    {
        var id = Guid.NewGuid();
        // (user, version) is unique: one version per exercise the user already has.
        var version = await db.Exercises.CountAsync(e => e.UserId == api.UserId) + 1;
        db.Exercises.Add(new Exercise
        {
            Id = id,
            UserId = api.UserId,
            Name = name,
            NormalizedName = ExerciseNames.Normalize(name),
            Aliases = aliases,
            PrimaryMuscleGroup = MuscleGroup.Chest,
            Version = version,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
            ClientUpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return id;
    });

    private static string WorkoutWith(string exerciseName, Guid exerciseId, bool aliasConfirmed = true, string? catalogId = null)
    {
        var confirmed = aliasConfirmed ? "true" : "false";
        var catalog = catalogId is null ? "null" : "\"" + catalogId + "\"";
        return $$"""
            {"rotation":{"type":"sequence","items":["a","off"]},
             "days":[{"key":"a","name":"Treino A","exercises":[
              {"key":"x","name":"{{exerciseName}}","exerciseId":"{{exerciseId}}","aliasConfirmed":{{confirmed}},"catalogId":{{catalog}},"sets":[{"repsMin":8,"repsMax":10}]}]}]}
            """;
    }

    private static Task<Exercise> ExerciseAsync(PlanApi api, Guid id) =>
        api.WithDbAsync(db => db.Exercises.AsNoTracking().SingleAsync(e => e.Id == id));

    [Fact]
    public async Task Draft_keeps_a_valid_catalog_id_and_activation_creates_the_exercise_with_it()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat-remada");
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);

        var id = await CreatedIdAsync(await api.CreateDraftAsync(
            fileId, PlanKind.Workout, PlanSamples.Workout, newExercises: [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back, "cat-remada")]));

        var draft = await api.GetAsync(id);
        Assert.Equal("cat-remada", Assert.Single(draft.NewExercises).CatalogId);
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(id)).StatusCode);
        var created = await api.WithDbAsync(db => db.Exercises.AsNoTracking().SingleAsync(e => e.UserId == api.UserId && e.NormalizedName == "remada curvada"));
        Assert.Equal("cat-remada", created.CatalogId);
        Assert.Equal(MuscleGroup.Back, created.PrimaryMuscleGroup);
        // The other exercise had no suggestion: no link.
        var other = await api.WithDbAsync(db => db.Exercises.AsNoTracking().SingleAsync(e => e.UserId == api.UserId && e.NormalizedName != "remada curvada"));
        Assert.Null(other.CatalogId);
    }

    [Fact]
    public async Task Draft_without_a_catalog_id_still_works()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);

        var id = await CreatedIdAsync(await api.CreateDraftAsync(
            fileId, PlanKind.Workout, PlanSamples.Workout, newExercises: [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back)]));

        Assert.Null(Assert.Single((await api.GetAsync(id)).NewExercises).CatalogId);
    }

    [Theory]
    [InlineData("missing-id")]
    [InlineData("")]
    public async Task Draft_drops_a_catalog_id_that_is_not_in_the_catalog(string catalogId)
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat-known");
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);

        var id = await CreatedIdAsync(await api.CreateDraftAsync(
            fileId, PlanKind.Workout, PlanSamples.Workout,
            newExercises: [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back, "cat-known"), new NewExerciseSuggestion("Rosca X", MuscleGroup.Biceps, catalogId)]));

        var suggestions = (await api.GetAsync(id)).NewExercises;
        Assert.Equal("cat-known", suggestions.Single(s => s.Name == "Remada Curvada").CatalogId);
        Assert.Null(suggestions.Single(s => s.Name == "Rosca X").CatalogId);
    }

    [Fact]
    public async Task Put_drops_unknown_catalog_ids_of_the_new_exercises_and_of_the_planned_exercises()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat-known");
        using var api = await PlanApi.CreateAsync(factory);
        var exercise = await AddExerciseAsync(api, "Remada Baixa");
        var draft = await api.ImportDraftAsync();

        var bad = await api.PutAsync(draft.Id, WorkoutWith("Remada Baixa", exercise, catalogId: "nope"), [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back, "nope")]);
        Assert.Equal(HttpStatusCode.OK, bad.StatusCode);
        var saved = await api.GetAsync(draft.Id);
        Assert.Null(Assert.Single(saved.NewExercises).CatalogId);
        Assert.True(PlannedCatalogId(saved).ValueKind is JsonValueKind.Null or JsonValueKind.Undefined);

        var good = await api.PutAsync(draft.Id, WorkoutWith("Remada Baixa", exercise, catalogId: "cat-known"), [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back, "cat-known")]);
        Assert.Equal(HttpStatusCode.OK, good.StatusCode);
        saved = await api.GetAsync(draft.Id);
        Assert.Equal("cat-known", Assert.Single(saved.NewExercises).CatalogId);
        Assert.Equal("cat-known", PlannedCatalogId(saved).GetString());
    }

    private static JsonElement PlannedCatalogId(PlanVersionResponse plan) =>
        plan.Document.GetProperty("days")[0].GetProperty("exercises")[0].TryGetProperty("catalogId", out var value) ? value : default;

    [Fact]
    public async Task Activation_links_the_catalog_to_a_matched_exercise_that_has_none_and_never_overrides()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat-new", "cat-other");
        using var api = await PlanApi.CreateAsync(factory);
        var bare = await AddExerciseAsync(api, "Remada Baixa");
        var linked = await AddExerciseAsync(api, "Remada Alta");
        await api.WithDbAsync(async db =>
        {
            var row = await db.Exercises.SingleAsync(e => e.Id == linked);
            row.CatalogId = "cat-other";
            await db.SaveChangesAsync();
            return 0;
        });

        foreach (var (name, id) in new[] { ("Remada Baixa", bare), ("Remada Alta", linked) })
        {
            var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
            var draft = await CreatedIdAsync(await api.CreateDraftAsync(fileId, PlanKind.Workout, WorkoutWith(name, id, aliasConfirmed: false, catalogId: "cat-new")));
            Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft)).StatusCode);
        }

        Assert.Equal("cat-new", (await ExerciseAsync(api, bare)).CatalogId);
        Assert.Equal("cat-other", (await ExerciseAsync(api, linked)).CatalogId);
    }

    [Fact]
    public async Task Activation_links_the_catalog_by_name_match_too()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat-new");
        using var api = await PlanApi.CreateAsync(factory);
        var bare = await AddExerciseAsync(api, "Remada Curvada");
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var doc = """
            {"rotation":{"type":"sequence","items":["a","off"]},
             "days":[{"key":"a","name":"Treino A","exercises":[{"key":"x","name":"remada curvada","catalogId":"cat-new","sets":[{"repsMin":8,"repsMax":10}]}]}]}
            """;
        var draft = await CreatedIdAsync(await api.CreateDraftAsync(fileId, PlanKind.Workout, doc));

        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft)).StatusCode);

        Assert.Equal("cat-new", (await ExerciseAsync(api, bare)).CatalogId);
    }

    [Fact]
    public async Task Activation_drops_a_catalog_link_that_vanished_after_the_draft()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat-gone");
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var id = await CreatedIdAsync(await api.CreateDraftAsync(
            fileId, PlanKind.Workout, PlanSamples.Workout, newExercises: [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back, "cat-gone")]));
        await CatalogData.ResetAsync(factory);

        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(id)).StatusCode);

        var created = await api.WithDbAsync(db => db.Exercises.AsNoTracking().SingleAsync(e => e.UserId == api.UserId && e.NormalizedName == "remada curvada"));
        Assert.Null(created.CatalogId);
    }

    [Fact]
    public async Task Activation_learns_the_plan_name_as_an_alias_once()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var exercise = await AddExerciseAsync(api, "Remada Baixa");
        var other = await AddExerciseAsync(api, "Remada Alta");

        for (var round = 0; round < 2; round++)
        {
            var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
            var id = await CreatedIdAsync(await api.CreateDraftAsync(fileId, PlanKind.Workout, WorkoutWith("Pulley Remada Ficticia", exercise)));
            Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(id)).StatusCode);
        }

        var learned = await ExerciseAsync(api, exercise);
        Assert.Equal(["Pulley Remada Ficticia"], learned.Aliases);
        Assert.Empty((await ExerciseAsync(api, other)).Aliases);
    }

    [Fact]
    public async Task Activation_does_not_learn_a_name_that_already_matches_or_belongs_to_another_exercise()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var exercise = await AddExerciseAsync(api, "Remada Baixa", "Remada Sentada");
        await AddExerciseAsync(api, "Remada Alta");

        foreach (var name in new[] { "remada baixa", "REMADA SENTADA", "Remada Alta" })
        {
            var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
            var id = await CreatedIdAsync(await api.CreateDraftAsync(fileId, PlanKind.Workout, WorkoutWith(name, exercise)));
            Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(id)).StatusCode);
        }

        Assert.Equal(["Remada Sentada"], (await ExerciseAsync(api, exercise)).Aliases);
    }

    [Fact]
    public async Task Activation_does_not_learn_an_alias_without_the_users_confirmation()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var exercise = await AddExerciseAsync(api, "Remada Baixa");
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var id = await CreatedIdAsync(await api.CreateDraftAsync(fileId, PlanKind.Workout, WorkoutWith("Pulley Remada Ficticia", exercise, aliasConfirmed: false)));

        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(id)).StatusCode);

        Assert.Empty((await ExerciseAsync(api, exercise)).Aliases);
    }
}
