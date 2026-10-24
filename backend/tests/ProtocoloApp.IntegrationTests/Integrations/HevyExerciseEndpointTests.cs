using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Integrations.Hevy;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Workouts;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;
using static ProtocoloApp.IntegrationTests.Integrations.HevyTestData;

namespace ProtocoloApp.IntegrationTests.Integrations;

/// <summary>"Exercícios do Hevy para confirmar": list the links and confirm them, with fictitious imported workouts.</summary>
public sealed class HevyExerciseEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly Uri ListUrl = new("/api/integrations/hevy/exercises", UriKind.Relative);

    private static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("America/Sao_Paulo");

    private sealed record Imported(PlanApi Api, Guid CurlId, Guid ProvisionalId, Guid LinkId, Guid SessionId);

    /// <summary>A user with one imported workout: the curl linked <c>auto</c>, the unknown exercise provisional and <c>pending</c>.</summary>
    private async Task<Imported> ImportedAsync()
    {
        var (api, curlId) = await UserWithPlanAsync(factory);
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var ctx = new ImportContext(SyncFrom, Zone, TimeProvider.System, _ => Task.FromResult<string?>("biceps"));
            Assert.Equal(ImportOutcome.Imported, await HevyImporter.ApplyUpdatedAsync(db, api.UserId, Workout(10), ctx, CancellationToken.None));
        }

        var link = await api.WithDbAsync(db => db.HevyExerciseLinks.AsNoTracking().SingleAsync(l => l.UserId == api.UserId && l.TemplateId == UnknownTemplate));
        var session = await api.WithDbAsync(db => db.WorkoutSessions.AsNoTracking().SingleAsync(s => s.UserId == api.UserId));
        return new Imported(api, curlId, link.ExerciseId, link.Id, session.Id);
    }

    private static async Task<List<HevyExerciseLinkResponse>> ListAsync(HttpClient client, bool? all = null)
    {
        var url = all is null ? ListUrl : new Uri($"{ListUrl}?all={(all.Value ? "true" : "false")}", UriKind.Relative);
        var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<List<HevyExerciseLinkResponse>>(PlanApi.Json))!;
    }

    private static Task<HttpResponseMessage> ConfirmAsync(HttpClient client, Guid linkId, Guid? exerciseId) =>
        client.PutAsJsonAsync(new Uri($"{ListUrl}/{linkId}", UriKind.Relative), new { exerciseId }, PlanApi.Json);

    private static Task<Exercise> ExerciseAsync(PlanApi api, Guid id) =>
        api.WithDbAsync(db => db.Exercises.AsNoTracking().SingleAsync(e => e.Id == id));

    [Fact]
    public async Task The_list_shows_pending_links_and_all_shows_every_one()
    {
        var s = await ImportedAsync();
        using var api = s.Api;

        var pending = await ListAsync(api.Client);
        var all = await ListAsync(api.Client, all: true);

        var link = Assert.Single(pending);
        Assert.Equal(s.LinkId, link.Id);
        Assert.Equal(UnknownTemplate, link.TemplateId);
        Assert.Equal(UnknownTitle, link.Title);
        Assert.Equal(s.ProvisionalId, link.ExerciseId);
        Assert.Equal(UnknownTitle, link.ExerciseName);
        Assert.Equal(HevyLinkStatus.Pending, link.Status);
        Assert.Equal(1, link.SetCount);
        Assert.Equal(2, all.Count);
        Assert.Contains(all, l => l.ExerciseId == s.CurlId && l.Status == HevyLinkStatus.Auto && l.SetCount == 1);
        Assert.Single(await ListAsync(api.Client, all: false));
    }

    [Fact]
    public async Task Confirming_another_exercise_moves_the_sets_learns_the_alias_and_removes_the_provisional()
    {
        var s = await ImportedAsync();
        using var api = s.Api;
        var lastVersion = (await SyncApi.PullAllAsync(api.Client)).Max(r => r.Version);

        var response = await ConfirmAsync(api.Client, s.LinkId, s.CurlId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var link = (await response.Content.ReadFromJsonAsync<HevyExerciseLinkResponse>(PlanApi.Json))!;
        Assert.Equal(HevyLinkStatus.Confirmed, link.Status);
        Assert.Equal(s.CurlId, link.ExerciseId);
        Assert.Equal(1, link.SetCount);
        var sets = await api.WithDbAsync(db => db.SetLogs.AsNoTracking().Where(x => x.UserId == api.UserId && x.HevyTemplateId == UnknownTemplate).ToListAsync());
        Assert.All(sets, x => Assert.Equal(s.CurlId, x.ExerciseId));
        Assert.Contains(UnknownTitle, (await ExerciseAsync(api, s.CurlId)).Aliases);
        Assert.NotNull((await ExerciseAsync(api, s.ProvisionalId)).DeletedAt);
        Assert.Empty(await ListAsync(api.Client));

        // Devices pull the moved sets, the new alias and the removal.
        var changed = (await SyncApi.PullAsync(api.Client, lastVersion)).Records;
        Assert.Contains(changed, r => r.Entity == "exercise" && r.Id == s.ProvisionalId && r.DeletedAt != null);
        Assert.Contains(changed, r => r.Entity == "exercise" && r.Id == s.CurlId);
        Assert.Contains(changed, r => r.Entity == "set_log" && r.Payload!.Value.GetProperty("exercise_id").GetGuid() == s.CurlId
            && sets.Any(x => x.Id == r.Id));
    }

    [Fact]
    public async Task Confirming_with_null_keeps_the_provisional_exercise()
    {
        var s = await ImportedAsync();
        using var api = s.Api;

        var response = await ConfirmAsync(api.Client, s.LinkId, null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var link = (await response.Content.ReadFromJsonAsync<HevyExerciseLinkResponse>(PlanApi.Json))!;
        Assert.Equal(HevyLinkStatus.Confirmed, link.Status);
        Assert.Equal(s.ProvisionalId, link.ExerciseId);
        Assert.Null((await ExerciseAsync(api, s.ProvisionalId)).DeletedAt);
        Assert.Empty(await ListAsync(api.Client));
    }

    [Fact]
    public async Task A_link_or_an_exercise_of_another_user_is_404()
    {
        var mine = await ImportedAsync();
        using var api = mine.Api;
        var other = await ImportedAsync();
        using var otherApi = other.Api;

        Assert.Equal(HttpStatusCode.NotFound, (await ConfirmAsync(api.Client, mine.LinkId, other.CurlId)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ConfirmAsync(api.Client, other.LinkId, null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ConfirmAsync(api.Client, Guid.NewGuid(), null)).StatusCode);
        Assert.Equal(HevyLinkStatus.Pending, Assert.Single(await ListAsync(api.Client)).Status);
        Assert.Equal(HevyLinkStatus.Pending, Assert.Single(await ListAsync(otherApi.Client)).Status);
    }

    [Fact]
    public async Task A_removed_exercise_is_404()
    {
        var s = await ImportedAsync();
        using var api = s.Api;
        await api.WithDbAsync(async db =>
        {
            await using var tx = await SyncWrites.BeginAsync(db, api.UserId);
            var curl = await db.Exercises.SingleAsync(e => e.Id == s.CurlId);
            curl.DeletedAt = DateTimeOffset.UtcNow;
            await SyncWrites.StampAsync(db, curl, api.UserId, TimeProvider.System);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return 0;
        });

        Assert.Equal(HttpStatusCode.NotFound, (await ConfirmAsync(api.Client, s.LinkId, s.CurlId)).StatusCode);
    }

    [Fact]
    public async Task A_provisional_exercise_still_used_by_a_swap_is_kept()
    {
        var s = await ImportedAsync();
        using var api = s.Api;
        await api.WithDbAsync(async db =>
        {
            await using var tx = await SyncWrites.BeginAsync(db, api.UserId);
            var change = new ExerciseChange
            {
                Id = Guid.NewGuid(),
                UserId = api.UserId,
                SessionId = s.SessionId,
                PlannedExerciseKey = "bench",
                Action = ExerciseChangeAction.Swapped,
                ReplacementExerciseId = s.ProvisionalId,
            };
            await SyncWrites.StampAsync(db, change, api.UserId, TimeProvider.System);
            db.ExerciseChanges.Add(change);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return 0;
        });

        var response = await ConfirmAsync(api.Client, s.LinkId, s.CurlId);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Null((await ExerciseAsync(api, s.ProvisionalId)).DeletedAt);
        var sets = await api.WithDbAsync(db => db.SetLogs.AsNoTracking().Where(x => x.UserId == api.UserId && x.HevyTemplateId == UnknownTemplate).ToListAsync());
        Assert.All(sets, x => Assert.Equal(s.CurlId, x.ExerciseId));
    }

    [Fact]
    public async Task A_provisional_exercise_mentioned_by_a_plan_version_is_kept()
    {
        var s = await ImportedAsync();
        using var api = s.Api;
        // A draft that names the provisional exercise by id somewhere in its document.
        await api.WithDbAsync(async db =>
        {
            var plan = await db.PlanVersions.FirstAsync(p => p.UserId == api.UserId);
            var copy = System.Text.Json.Nodes.JsonNode.Parse(plan.Document.RootElement.GetRawText())!.AsObject();
            copy["note_for_test"] = s.ProvisionalId.ToString();
            plan.Document = System.Text.Json.JsonDocument.Parse(copy.ToJsonString());
            return await db.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.OK, (await ConfirmAsync(api.Client, s.LinkId, s.CurlId)).StatusCode);

        Assert.Null((await ExerciseAsync(api, s.ProvisionalId)).DeletedAt);
    }
}
