using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using ProtocoloApp.Api.Features.ExerciseCatalog;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.IntegrationTests.ExerciseCatalog;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Plans;

/// <summary>Links kept while the catalog was not synced, cleared once a complete sync shows they point to nothing.</summary>
public sealed class CatalogLinkCleanupTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset Now = new(2026, 10, 20, 12, 0, 0, TimeSpan.Zero);

    private sealed class FakeClient(Func<string?, ExerciseDbPage?> respond) : IExerciseDbClient
    {
        public Task<ExerciseDbPage?> GetPageAsync(string? after, CancellationToken ct) => Task.FromResult(respond(after));
    }

    private static ExerciseDbPage Page(params string[] ids) =>
        new(ids.Select(i => new ExerciseDbItem(i, $"exercise {i}", null, ["back"], ["lats"], [], ["cable"])).ToList(), false, null);

    private ExerciseCatalogSync CreateSync(IExerciseDbClient client)
        => new(
            factory.Services.GetRequiredService<IServiceScopeFactory>(),
            client,
            new FakeTimeProvider(Now),
            Options.Create(new ExerciseCatalogOptions { PageDelayMilliseconds = 0 }),
            NullLogger<ExerciseCatalogSync>.Instance);

    private static string Workout(Guid exerciseId, string catalogId) => $$"""
        {"rotation":{"type":"sequence","items":["a","off"]},
         "days":[{"key":"a","name":"Treino A","exercises":[
          {"key":"x","name":"Remada Baixa","exerciseId":"{{exerciseId}}","catalogId":"{{catalogId}}","sets":[{"repsMin":8,"repsMax":10}]}]}]}
        """;

    private static JsonElement PlannedCatalogId(PlanVersionResponse plan) =>
        plan.Document.GetProperty("days")[0].GetProperty("exercises")[0].TryGetProperty("catalogId", out var value) ? value : default;

    private static Task<Exercise> ExerciseAsync(PlanApi api, Guid id) =>
        api.WithDbAsync(db => db.Exercises.AsNoTracking().SingleAsync(e => e.Id == id));

    private static Task<Guid> AddExerciseAsync(PlanApi api, string name, string? catalogId) => api.WithDbAsync(async db =>
    {
        var id = Guid.NewGuid();
        var version = await db.Exercises.CountAsync(e => e.UserId == api.UserId) + 1;
        db.Exercises.Add(new Exercise
        {
            Id = id,
            UserId = api.UserId,
            Name = name,
            NormalizedName = ExerciseNames.Normalize(name),
            PrimaryMuscleGroup = MuscleGroup.Back,
            CatalogId = catalogId,
            Version = version,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
            ClientUpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return id;
    });

    [Fact]
    public async Task A_complete_sync_clears_the_links_the_catalog_does_not_have_and_keeps_the_others()
    {
        await CatalogData.ResetAsync(factory);
        using var api = await PlanApi.CreateAsync(factory);
        var stale = await AddExerciseAsync(api, "Remada Baixa", "cat-stale");
        var real = await AddExerciseAsync(api, "Remada Alta", "cat-real");
        var staleVersion = (await ExerciseAsync(api, stale)).Version;
        var realVersion = (await ExerciseAsync(api, real)).Version;

        // Saved while the catalog is empty: both links are kept as they are.
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var create = await api.CreateDraftAsync(
            fileId, PlanKind.Workout, Workout(stale, "cat-stale"),
            newExercises: [new NewExerciseSuggestion("Puxada Nova", MuscleGroup.Back, "cat-stale"), new NewExerciseSuggestion("Remada Nova", MuscleGroup.Back, "cat-real")]);
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var draftId = (await create.Content.ReadFromJsonAsync<CreateDraftResponse>(PlanApi.Json))!.PlanVersionId;
        var before = await api.GetAsync(draftId);
        Assert.Equal("cat-stale", PlannedCatalogId(before).GetString());
        var draftVersion = await api.WithDbAsync(db => db.PlanVersions.AsNoTracking().Where(p => p.Id == draftId).Select(p => p.Version).SingleAsync());

        var result = await CreateSync(new FakeClient(_ => Page("cat-real"))).SyncAsync(CancellationToken.None);

        Assert.True(result.Complete);
        var cleared = await ExerciseAsync(api, stale);
        Assert.Null(cleared.CatalogId);
        Assert.True(cleared.Version > staleVersion);
        var kept = await ExerciseAsync(api, real);
        Assert.Equal("cat-real", kept.CatalogId);
        Assert.Equal(realVersion, kept.Version);

        var after = await api.GetAsync(draftId);
        Assert.Equal(JsonValueKind.Null, PlannedCatalogId(after).ValueKind);
        Assert.Null(after.NewExercises.Single(s => s.Name == "Puxada Nova").CatalogId);
        Assert.Equal("cat-real", after.NewExercises.Single(s => s.Name == "Remada Nova").CatalogId);
        Assert.True(await api.WithDbAsync(db => db.PlanVersions.AsNoTracking().Where(p => p.Id == draftId).Select(p => p.Version).SingleAsync()) > draftVersion);

        // Idempotent: a second run finds nothing to change.
        Assert.Equal(new CatalogLinkCleanupResult(0, 0), await CreateSync(new FakeClient(_ => null)).CleanLinksAsync(CancellationToken.None));
    }

    [Fact]
    public async Task An_incomplete_sync_keeps_every_link()
    {
        await CatalogData.ResetAsync(factory);
        using var api = await PlanApi.CreateAsync(factory);
        var pending = await AddExerciseAsync(api, "Remada Baixa", "cat-pending");

        // The first page arrives, the second fails: rows but no complete sync.
        var result = await CreateSync(new FakeClient(after => after is null ? new ExerciseDbPage(Page("cat-first").Items, true, "c1") : null))
            .SyncAsync(CancellationToken.None);

        Assert.False(result.Complete);
        Assert.Equal("cat-pending", (await ExerciseAsync(api, pending)).CatalogId);
        Assert.Equal(new CatalogLinkCleanupResult(0, 0), await CreateSync(new FakeClient(_ => null)).CleanLinksAsync(CancellationToken.None));
        Assert.Equal("cat-pending", (await ExerciseAsync(api, pending)).CatalogId);
    }

    [Fact]
    public async Task A_draft_without_links_to_clear_is_left_untouched()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, Now, "cat-real");
        using var api = await PlanApi.CreateAsync(factory);
        var exercise = await AddExerciseAsync(api, "Remada Baixa", null);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var create = await api.CreateDraftAsync(fileId, PlanKind.Workout, Workout(exercise, "cat-real"));
        var draftId = (await create.Content.ReadFromJsonAsync<CreateDraftResponse>(PlanApi.Json))!.PlanVersionId;
        var version = await api.WithDbAsync(db => db.PlanVersions.AsNoTracking().Where(p => p.Id == draftId).Select(p => p.Version).SingleAsync());

        var result = await CreateSync(new FakeClient(_ => null)).CleanLinksAsync(CancellationToken.None);

        Assert.Equal(0, result.Drafts);
        Assert.Equal(version, await api.WithDbAsync(db => db.PlanVersions.AsNoTracking().Where(p => p.Id == draftId).Select(p => p.Version).SingleAsync()));
        Assert.Equal("cat-real", PlannedCatalogId(await api.GetAsync(draftId)).GetString());
    }
}
