using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.IntegrationTests.ExerciseCatalog;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Plans;

public sealed class ExerciseEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static async Task<List<ExerciseResponse>> ListAsync(HttpClient client) =>
        (await client.GetFromJsonAsync<List<ExerciseResponse>>(new Uri("/api/exercises", UriKind.Relative), PlanApi.Json))!;

    private static Task<HttpResponseMessage> PutAsync(HttpClient client, Guid id, UpdateExerciseRequest request) =>
        client.PutAsJsonAsync(new Uri($"/api/exercises/{id}", UriKind.Relative), request, PlanApi.Json);

    private static Task<HttpResponseMessage> PutCatalogAsync(HttpClient client, Guid id, SetExerciseCatalogRequest request) =>
        client.PutAsJsonAsync(new Uri($"/api/exercises/{id}/catalog", UriKind.Relative), request, PlanApi.Json);

    [Fact]
    public async Task List_returns_only_the_users_live_exercises_sorted_by_name()
    {
        using var api = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        Assert.Empty(await ListAsync(api.Client));
        await api.ActivateAsync((await api.ImportDraftAsync()).Id);
        await other.ActivateAsync((await other.ImportDraftAsync()).Id);

        var list = await ListAsync(api.Client);

        Assert.Equal(["Remada Curvada", "Rosca Alternada C/ Halteres"], list.Select(e => e.Name));
        Assert.All(list, e => Assert.Equal(MuscleGroup.Other, e.Group));
    }

    [Fact]
    public async Task Put_updates_group_and_aliases_and_bumps_the_sync_version()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await api.ActivateAsync((await api.ImportDraftAsync()).Id);
        var exercise = (await ListAsync(api.Client)).First(e => e.Name.StartsWith("Remada", StringComparison.Ordinal));
        var before = await api.WithDbAsync(db => db.Exercises.AsNoTracking().SingleAsync(e => e.Id == exercise.Id));

        var response = await PutAsync(api.Client, exercise.Id, new UpdateExerciseRequest(MuscleGroup.LowerBack, ["Remada pronada", " Remada pronada ", "Barra curva"]));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<ExerciseResponse>(PlanApi.Json))!;
        Assert.Equal(MuscleGroup.LowerBack, body.Group);
        Assert.Equal(["Remada pronada", "Barra curva"], body.Aliases);
        var after = await api.WithDbAsync(db => db.Exercises.AsNoTracking().SingleAsync(e => e.Id == exercise.Id));
        Assert.True(after.Version > before.Version);
        var pulled = (await SyncApi.PullAllAsync(api.Client)).Single(r => r.Entity == "exercise" && r.Id == exercise.Id);
        Assert.Equal("lower_back", pulled.Payload!.Value.GetProperty("primary_muscle_group").GetString());
    }

    [Fact]
    public async Task Put_of_another_users_or_missing_exercise_returns_404()
    {
        using var owner = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        await owner.ActivateAsync((await owner.ImportDraftAsync()).Id);
        var exercise = (await ListAsync(owner.Client))[0];

        Assert.Equal(HttpStatusCode.NotFound, (await PutAsync(other.Client, exercise.Id, new UpdateExerciseRequest(MuscleGroup.Chest, []))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await PutAsync(owner.Client, Guid.NewGuid(), new UpdateExerciseRequest(MuscleGroup.Chest, []))).StatusCode);
    }

    [Fact]
    public async Task Put_rejects_invalid_groups_and_aliases()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await api.ActivateAsync((await api.ImportDraftAsync()).Id);
        var exercise = (await ListAsync(api.Client))[0];

        var tooMany = await PutAsync(api.Client, exercise.Id, new UpdateExerciseRequest(MuscleGroup.Chest, Enumerable.Range(0, 21).Select(i => $"apelido {i}").ToArray()));
        var blank = await PutAsync(api.Client, exercise.Id, new UpdateExerciseRequest(MuscleGroup.Chest, ["!!!"]));
        var badGroup = await api.Client.PutAsync(
            new Uri($"/api/exercises/{exercise.Id}", UriKind.Relative),
            new StringContent("""{"group":"nope","aliases":[]}""", Encoding.UTF8, "application/json"));
        var outOfRange = await PutAsync(api.Client, exercise.Id, new UpdateExerciseRequest((MuscleGroup)99, []));

        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, badGroup.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, outOfRange.StatusCode);
    }

    [Fact]
    public async Task Put_of_group_and_aliases_keeps_the_catalog_link_and_catalog_put_keeps_group_and_aliases()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat_keep");
        using var api = await PlanApi.CreateAsync(factory);
        await api.ActivateAsync((await api.ImportDraftAsync()).Id);
        var exercise = (await ListAsync(api.Client))[0];
        await PutCatalogAsync(api.Client, exercise.Id, new SetExerciseCatalogRequest("cat_keep"));

        var updated = await PutAsync(api.Client, exercise.Id, new UpdateExerciseRequest(MuscleGroup.Chest, ["apelido"]));
        var linked = await PutCatalogAsync(api.Client, exercise.Id, new SetExerciseCatalogRequest("cat_keep"));

        var afterGroup = (await updated.Content.ReadFromJsonAsync<ExerciseResponse>(PlanApi.Json))!;
        Assert.Equal("cat_keep", afterGroup.CatalogId);
        var afterCatalog = (await linked.Content.ReadFromJsonAsync<ExerciseResponse>(PlanApi.Json))!;
        Assert.Equal(MuscleGroup.Chest, afterCatalog.Group);
        Assert.Equal(["apelido"], afterCatalog.Aliases);
    }

    [Fact]
    public async Task Put_catalog_of_another_users_or_missing_exercise_returns_404()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat_404");
        using var owner = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        await owner.ActivateAsync((await owner.ImportDraftAsync()).Id);
        var exercise = (await ListAsync(owner.Client))[0];

        Assert.Equal(HttpStatusCode.NotFound, (await PutCatalogAsync(other.Client, exercise.Id, new SetExerciseCatalogRequest("cat_404"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await PutCatalogAsync(owner.Client, Guid.NewGuid(), new SetExerciseCatalogRequest("cat_404"))).StatusCode);
    }

    [Fact]
    public async Task Put_catalog_links_an_existing_catalog_exercise_returns_it_and_pulls_it()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat_ok");
        using var api = await PlanApi.CreateAsync(factory);
        await api.ActivateAsync((await api.ImportDraftAsync()).Id);
        var exercise = (await ListAsync(api.Client))[0];

        var response = await PutCatalogAsync(api.Client, exercise.Id, new SetExerciseCatalogRequest("cat_ok"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("cat_ok", (await response.Content.ReadFromJsonAsync<ExerciseResponse>(PlanApi.Json))!.CatalogId);
        Assert.Equal("cat_ok", (await ListAsync(api.Client)).Single(e => e.Id == exercise.Id).CatalogId);
        var pulled = (await SyncApi.PullAllAsync(api.Client)).Single(r => r.Entity == "exercise" && r.Id == exercise.Id);
        Assert.Equal("cat_ok", pulled.Payload!.Value.GetProperty("catalog_id").GetString());
    }

    [Fact]
    public async Task Put_catalog_with_null_catalog_id_clears_the_link()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, DateTimeOffset.UtcNow, "cat_clear");
        using var api = await PlanApi.CreateAsync(factory);
        await api.ActivateAsync((await api.ImportDraftAsync()).Id);
        var exercise = (await ListAsync(api.Client))[0];
        await PutCatalogAsync(api.Client, exercise.Id, new SetExerciseCatalogRequest("cat_clear"));

        var response = await PutCatalogAsync(api.Client, exercise.Id, new SetExerciseCatalogRequest(null));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Null((await response.Content.ReadFromJsonAsync<ExerciseResponse>(PlanApi.Json))!.CatalogId);
        var pulled = (await SyncApi.PullAllAsync(api.Client)).Single(r => r.Entity == "exercise" && r.Id == exercise.Id);
        Assert.Equal(System.Text.Json.JsonValueKind.Null, pulled.Payload!.Value.GetProperty("catalog_id").ValueKind);
    }

    [Theory]
    [InlineData("does_not_exist")]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Put_catalog_with_an_unknown_catalog_id_is_a_400_problem_and_changes_nothing(string catalogId)
    {
        await CatalogData.ResetAsync(factory);
        using var api = await PlanApi.CreateAsync(factory);
        await api.ActivateAsync((await api.ImportDraftAsync()).Id);
        var exercise = (await ListAsync(api.Client))[0];

        var response = await PutCatalogAsync(api.Client, exercise.Id, new SetExerciseCatalogRequest(catalogId));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("catalogId", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Null((await ListAsync(api.Client)).Single(e => e.Id == exercise.Id).CatalogId);
    }
}
