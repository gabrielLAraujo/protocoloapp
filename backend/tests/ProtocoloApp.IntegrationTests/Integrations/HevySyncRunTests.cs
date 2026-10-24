using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Integrations.Hevy;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using static ProtocoloApp.IntegrationTests.Integrations.HevyTestData;

namespace ProtocoloApp.IntegrationTests.Integrations;

/// <summary>"Sincronizar agora" and the scheduler, with the fake client scripted per (fictitious) key.</summary>
public sealed class HevySyncRunTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(20);

    private static Task<HevyConnection> RowAsync(PlanApi api) =>
        api.WithDbAsync(db => db.HevyConnections.AsNoTracking().SingleAsync(c => c.UserId == api.UserId));

    private static Task<int> LiveSessionsAsync(PlanApi api) =>
        api.WithDbAsync(db => db.WorkoutSessions.CountAsync(s => s.UserId == api.UserId && s.DeletedAt == null));

    private List<(string Key, string Call, int Page, DateTimeOffset? Since)> CallsOf(string key) =>
        factory.Hevy.Calls.Where(c => c.Key == key).ToList();

    private static async Task<HevySyncResult> SyncOkAsync(PlanApi api)
    {
        var response = await api.Client.PostAsync(SyncUrl, null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<HevySyncResult>(PlanApi.Json))!;
    }

    [Fact]
    public async Task The_first_run_reads_workouts_until_a_page_is_wholly_before_sync_from_and_sets_the_cursor()
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        factory.Hevy.WorkoutPages[key] = Pages(5, [Workout(10), Workout(8)], [Workout(4), Workout(2)]);
        var before = DateTimeOffset.UtcNow;

        var result = await SyncOkAsync(api);

        var after = DateTimeOffset.UtcNow;
        Assert.Equal(2, result.Imported);
        Assert.Equal(1, result.PendingExercises);
        Assert.Equal(new[] { 1, 2 }, CallsOf(key).Where(c => c.Call == "workouts").Select(c => c.Page));
        // The unknown exercise asked for its template group once.
        Assert.Single(CallsOf(key), c => c.Call == "templates");
        Assert.Equal(2, await LiveSessionsAsync(api));
        var row = await RowAsync(api);
        Assert.NotNull(row.Cursor);
        Assert.InRange(row.Cursor!.Value, before - HevySyncRunner.CursorSlack - TimeSpan.FromSeconds(1), after - HevySyncRunner.CursorSlack);
        Assert.NotNull(row.LastSuccessAt);
        Assert.NotNull(row.LastAttemptAt);
        Assert.Null(row.LastError);
        Assert.Equal(result, HevyConnections.ReadResult(row.LastResult));
    }

    [Fact]
    public async Task The_next_run_reads_events_since_the_cursor()
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        var first = Workout(10);
        factory.Hevy.WorkoutPages[key] = Pages(1, [first]);
        await SyncOkAsync(api);
        var cursor = (await RowAsync(api)).Cursor!.Value;
        factory.Hevy.EventPages[key] = (_, page) => HevyResult<HevyPage<HevyEvent>>.Ok(new HevyPage<HevyEvent>(
            page == 1 ? [new HevyEvent(HevyEvent.Updated, Workout(12), null, null), new HevyEvent(HevyEvent.Deleted, null, first.Id, null)] : [],
            page,
            1,
            0));

        var result = await SyncOkAsync(api);

        Assert.Equal(1, result.Imported);
        Assert.Equal(1, result.Deleted);
        var events = Assert.Single(CallsOf(key), c => c.Call == "events");
        Assert.Equal(cursor, events.Since);
        Assert.Single(CallsOf(key), c => c.Call == "workouts");
        Assert.Equal(1, await LiveSessionsAsync(api));
        Assert.True((await RowAsync(api)).Cursor > cursor);
    }

    [Fact]
    public async Task A_rate_limit_on_page_2_keeps_the_cursor_and_what_was_imported()
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        var pages = Pages(3, [Workout(10)]);
        factory.Hevy.WorkoutPages[key] = page => page == 2 ? HevyResult<HevyPage<HevyWorkout>>.Fail(HevyError.RateLimited) : pages(page);

        var response = await api.Client.PostAsync(SyncUrl, null);

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("rate_limited", problem.RootElement.GetProperty("lastError").GetString());
        var row = await RowAsync(api);
        Assert.Null(row.Cursor);
        Assert.Null(row.LastSuccessAt);
        Assert.Equal("rate_limited", row.LastError);
        Assert.Equal(1, await LiveSessionsAsync(api));
        Assert.DoesNotContain(CallsOf(key), c => c.Page == 3);
    }

    [Theory]
    [InlineData(HevyError.Format, "format")]
    [InlineData(HevyError.Unauthorized, "unauthorized")]
    public async Task A_hevy_error_stops_the_run_and_is_shown_in_the_status(HevyError error, string code)
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        factory.Hevy.WorkoutPages[key] = _ => HevyResult<HevyPage<HevyWorkout>>.Fail(error);

        var response = await api.Client.PostAsync(SyncUrl, null);

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(key, raw, StringComparison.Ordinal);
        using var status = JsonDocument.Parse(await (await api.Client.GetAsync(Url)).Content.ReadAsStringAsync());
        Assert.Equal(code, status.RootElement.GetProperty("lastError").GetString());
        Assert.Null((await RowAsync(api)).Cursor);
        Assert.Single(CallsOf(key), c => c.Call == "workouts");
    }

    [Fact]
    public async Task Two_syncs_at_once_one_runs_and_the_other_is_409()
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        var gate = (Entered: new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously), Release: new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
        factory.Hevy.Gates[key] = gate;
        try
        {
            var first = api.Client.PostAsync(SyncUrl, null);
            await gate.Entered.Task.WaitAsync(Wait);

            using var status = JsonDocument.Parse(await (await api.Client.GetAsync(Url)).Content.ReadAsStringAsync());
            Assert.True(status.RootElement.GetProperty("running").GetBoolean());
            var second = await api.Client.PostAsync(SyncUrl, null);
            Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
            using var problem = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
            Assert.Equal(HevySyncEndpoints.AlreadyRunningMessage, problem.RootElement.GetProperty("detail").GetString());

            gate.Release.SetResult();
            Assert.Equal(HttpStatusCode.OK, (await first.WaitAsync(Wait)).StatusCode);
        }
        finally
        {
            gate.Release.TrySetResult();
            factory.Hevy.Gates.TryRemove(key, out _);
        }

        using var after = JsonDocument.Parse(await (await api.Client.GetAsync(Url)).Content.ReadAsStringAsync());
        Assert.False(after.RootElement.GetProperty("running").GetBoolean());
    }

    [Fact]
    public async Task Sync_without_a_connection_is_404()
    {
        using var api = await PlanApi.CreateAsync(factory);

        var response = await api.Client.PostAsync(SyncUrl, null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(HevySyncEndpoints.NotConnectedMessage, problem.RootElement.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task The_scheduler_syncs_every_user_even_when_one_key_is_unreadable()
    {
        var (broken, _) = await UserWithPlanAsync(factory);
        using var _broken = broken;
        var brokenKey = NewKey();
        await ConnectAsync(broken, brokenKey);
        await broken.WithDbAsync(async db =>
        {
            var row = await db.HevyConnections.SingleAsync(c => c.UserId == broken.UserId);
            row.ApiKeyCipher = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
            return await db.SaveChangesAsync();
        });
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        factory.Hevy.WorkoutPages[key] = Pages(1, [Workout(10)]);

        var scheduler = factory.Services.GetRequiredService<HevySyncScheduler>();
        var succeeded = await scheduler.RunOnceAsync(CancellationToken.None);

        Assert.True(succeeded >= 1);
        Assert.Equal(1, await LiveSessionsAsync(api));
        Assert.NotNull((await RowAsync(api)).Cursor);
        var brokenRow = await RowAsync(broken);
        Assert.Equal(HevyRunResult.KeyUnreadable, brokenRow.LastError);
        Assert.Null(brokenRow.Cursor);
        Assert.NotNull(brokenRow.LastAttemptAt);
    }
}
