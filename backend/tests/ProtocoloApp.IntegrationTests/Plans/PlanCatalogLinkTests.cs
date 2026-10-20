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

    private static string WorkoutWith(string exerciseName, Guid exerciseId) => $$"""
        {"days":[{"key":"a","name":"Treino A","exercises":[
          {"key":"x","name":"{{exerciseName}}","exerciseId":"{{exerciseId}}","sets":[{"repsMin":8,"repsMax":10}]}]}]}
        """;

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
    public async Task Draft_rejects_a_catalog_id_that_is_not_in_the_catalog(string catalogId)
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat-known");
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);

        var response = await api.CreateDraftAsync(
            fileId, PlanKind.Workout, PlanSamples.Workout,
            newExercises: [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back, "cat-known"), new NewExerciseSuggestion("Rosca X", MuscleGroup.Biceps, catalogId)]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = await ErrorsAsync(response);
        Assert.True(errors.TryGetProperty("newExercises[1].catalogId", out _));
        Assert.False(errors.TryGetProperty("newExercises[0].catalogId", out _));
    }

    [Fact]
    public async Task Put_validates_the_catalog_id_of_the_new_exercises()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat-known");
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync();

        var bad = await api.PutAsync(draft.Id, PlanSamples.Workout, [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back, "nope")]);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.True((await ErrorsAsync(bad)).TryGetProperty("newExercises[0].catalogId", out _));

        var good = await api.PutAsync(draft.Id, PlanSamples.Workout, [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back, "cat-known")]);
        Assert.Equal(HttpStatusCode.OK, good.StatusCode);
        Assert.Equal("cat-known", Assert.Single((await api.GetAsync(draft.Id)).NewExercises).CatalogId);
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
}
