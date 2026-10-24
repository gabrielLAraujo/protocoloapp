using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ProtocoloApp.Api.Features.Integrations.Hevy;
using ProtocoloApp.Api.Features.Integrations.Secrets;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;
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

    /// <summary>The system clock without the pauses between pages, so a run can read up to the page cap quickly.</summary>
    private sealed class NoDelayClock : TimeProvider
    {
        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period) =>
            TimeProvider.System.CreateTimer(callback, state, TimeSpan.Zero, period);
    }

    /// <summary>A run like the endpoint's, with the services of the app but <see cref="NoDelayClock"/>.</summary>
    private async Task<HevyRunResult> RunFastAsync(Guid userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var runner = new HevySyncRunner(
            services.GetRequiredService<AppDbContext>(),
            factory.Hevy,
            services.GetRequiredService<ISecretProtector>(),
            services.GetRequiredService<IZoneProvider>(),
            new NoDelayClock(),
            services.GetRequiredService<ILogger<HevySyncRunner>>());
        return await runner.RunAsync(userId, CancellationToken.None);
    }

    private static async Task PatchSyncFromAsync(PlanApi api, DateOnly syncFrom) =>
        Assert.Equal(HttpStatusCode.OK, (await api.Client.PatchAsJsonAsync(Url, new { syncFrom }, PlanApi.Json)).StatusCode);

    private static async Task<string?> StatusErrorAsync(PlanApi api)
    {
        using var status = JsonDocument.Parse(await (await api.Client.GetAsync(Url)).Content.ReadAsStringAsync());
        return status.RootElement.GetProperty("lastError").GetString();
    }

    private static Task<WorkoutSessionRow> SessionAsync(PlanApi api, string externalId) =>
        api.WithDbAsync(db => db.WorkoutSessions.AsNoTracking()
            .Where(x => x.UserId == api.UserId && x.ExternalId == externalId)
            .Select(x => new WorkoutSessionRow(x.Id, x.DeletedAt))
            .SingleAsync());

    private sealed record WorkoutSessionRow(Guid Id, DateTimeOffset? DeletedAt);

    [Fact]
    public async Task A_first_run_stopped_by_the_page_cap_keeps_no_cursor_says_incomplete_and_removes_nothing()
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        var earlier = NewId();
        factory.Hevy.WorkoutPages[key] = Pages(1, [Workout(9, earlier)]);
        await SyncOkAsync(api);
        await PatchSyncFromAsync(api, SyncFrom);
        // More pages than one run reads, each with a workout after sync_from, none of them the earlier one.
        var ids = Enumerable.Range(0, HevyClient.MaxPagesPerRun + 10).Select(_ => NewId()).ToArray();
        factory.Hevy.WorkoutPages[key] = page =>
            HevyResult<HevyPage<HevyWorkout>>.Ok(new HevyPage<HevyWorkout>([Workout(10 + page % 15, ids[page])], page, ids.Length, 0));

        var first = await RunFastAsync(api.UserId);

        Assert.Equal(HevyRunResult.Incomplete, first.Error);
        Assert.Equal(HevyClient.MaxPagesPerRun, first.Result!.Imported);
        Assert.Equal(0, first.Result.Deleted);
        var row = await RowAsync(api);
        Assert.Null(row.Cursor);
        Assert.Equal(HevyRunResult.Incomplete, row.LastError);
        Assert.Equal(first.Result, HevyConnections.ReadResult(row.LastResult));
        Assert.Equal("incomplete", await StatusErrorAsync(api));
        // Not seen because of the cap, not because Hevy deleted it: it stays.
        Assert.Null((await SessionAsync(api, earlier)).DeletedAt);

        // The next run reads the same pages again: nothing is lost, nothing is duplicated, the cursor still waits.
        var second = await RunFastAsync(api.UserId);
        Assert.Equal(HevyRunResult.Incomplete, second.Error);
        Assert.Equal(0, second.Result!.Imported);
        Assert.Equal(HevyClient.MaxPagesPerRun, second.Result.Unchanged);
        Assert.Null((await RowAsync(api)).Cursor);
        Assert.Equal(HevyClient.MaxPagesPerRun + 1, await LiveSessionsAsync(api));
    }

    [Fact]
    public async Task An_incremental_run_stopped_by_the_page_cap_keeps_the_cursor()
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        factory.Hevy.WorkoutPages[key] = Pages(1, [Workout(10)]);
        await SyncOkAsync(api);
        var cursor = (await RowAsync(api)).Cursor;
        // Empty pages (as when every event is of a type we skip) up to a page_count past the cap.
        factory.Hevy.EventPages[key] = (_, page) =>
            HevyResult<HevyPage<HevyEvent>>.Ok(new HevyPage<HevyEvent>([], page, HevyClient.MaxPagesPerRun + 30, 1));

        var run = await RunFastAsync(api.UserId);

        Assert.Equal(HevyRunResult.Incomplete, run.Error);
        Assert.Equal(HevyClient.MaxPagesPerRun, CallsOf(key).Count(c => c.Call == "events"));
        var row = await RowAsync(api);
        Assert.Equal(cursor, row.Cursor);
        Assert.Equal(HevyRunResult.Incomplete, row.LastError);
    }

    [Fact]
    public async Task A_page_of_only_skipped_events_does_not_end_the_run()
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        factory.Hevy.WorkoutPages[key] = Pages(1, [Workout(10)]);
        await SyncOkAsync(api);
        var cursor = (await RowAsync(api)).Cursor;
        factory.Hevy.EventPages[key] = (_, page) => HevyResult<HevyPage<HevyEvent>>.Ok(page == 1
            ? new HevyPage<HevyEvent>([], 1, 2, 1)
            : new HevyPage<HevyEvent>([new HevyEvent(HevyEvent.Updated, Workout(12), null, null)], 2, 2, 0));

        var result = await SyncOkAsync(api);

        Assert.Equal(1, result.Imported);
        Assert.Equal(new[] { 1, 2 }, CallsOf(key).Where(c => c.Call == "events").Select(c => c.Page));
        var row = await RowAsync(api);
        Assert.True(row.Cursor > cursor);
        Assert.Null(row.LastError);
    }

    [Fact]
    public async Task An_unexpected_failure_is_stored_as_internal_and_keeps_the_cursor_and_what_was_imported()
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        var pages = Pages(3, [Workout(10)]);
        factory.Hevy.WorkoutPages[key] = page => page == 2 ? throw new InvalidOperationException("fake failure") : pages(page);

        var response = await api.Client.PostAsync(SyncUrl, null);

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("internal", problem.RootElement.GetProperty("lastError").GetString());
        var row = await RowAsync(api);
        Assert.Null(row.Cursor);
        Assert.Null(row.LastSuccessAt);
        Assert.Equal(HevyRunResult.Internal, row.LastError);
        Assert.Equal("internal", await StatusErrorAsync(api));
        Assert.Equal(1, await LiveSessionsAsync(api));
    }

    [Fact]
    public async Task A_whole_first_run_after_the_cursor_reset_removes_sessions_deleted_in_hevy_meanwhile()
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        var (kept, gone, dismissed, older) = (NewId(), NewId(), NewId(), NewId());
        factory.Hevy.WorkoutPages[key] = Pages(1, [Workout(10, kept), Workout(8, gone), Workout(7, dismissed), Workout(6, older)]);
        Assert.Equal(4, (await SyncOkAsync(api)).Imported);
        // Deleted in the app ("manter só um"): it must stay as the app left it.
        var dismissedRow = await SessionAsync(api, dismissed);
        Assert.Equal(SyncResultStatus.Applied, (await SyncApi.PushOneAsync(api.Client,
            new SyncChange("workout_session", dismissedRow.Id, SyncOp.Delete, null, DateTimeOffset.UtcNow.AddSeconds(1)))).Status);
        var dismissedAt = (await SessionAsync(api, dismissed)).DeletedAt;
        // A later start date resets the cursor; meanwhile two workouts went away in Hevy (one of them before the new date).
        await PatchSyncFromAsync(api, new DateOnly(2026, 3, 7));
        factory.Hevy.WorkoutPages[key] = Pages(1, [Workout(10, kept)]);

        var result = await SyncOkAsync(api);

        Assert.Equal(1, result.Deleted);
        Assert.Equal(1, result.Unchanged);
        Assert.Null((await SessionAsync(api, kept)).DeletedAt);
        Assert.NotNull((await SessionAsync(api, gone)).DeletedAt);
        Assert.Equal(dismissedAt, (await SessionAsync(api, dismissed)).DeletedAt);
        // Before the start date: out of the reconciliation.
        Assert.Null((await SessionAsync(api, older)).DeletedAt);
        // The removal went through the deleted-event path: sets gone and the day's workout mark cleared.
        var goneId = (await SessionAsync(api, gone)).Id;
        Assert.False(await api.WithDbAsync(db => db.SetLogs.AnyAsync(x => x.SessionId == goneId && x.DeletedAt == null)));
        var mark = await api.WithDbAsync(db => db.AdherenceLogs.AsNoTracking().SingleAsync(a => a.UserId == api.UserId && a.Date == new DateOnly(2026, 3, 8)));
        Assert.NotNull(mark.DeletedAt);
        Assert.NotNull((await RowAsync(api)).Cursor);
    }

    [Fact]
    public async Task A_first_run_with_unreadable_items_removes_nothing()
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        var (kept, unsure) = (NewId(), NewId());
        factory.Hevy.WorkoutPages[key] = Pages(1, [Workout(10, kept), Workout(8, unsure)]);
        await SyncOkAsync(api);
        await PatchSyncFromAsync(api, SyncFrom);
        // The second workout may be the item Hevy sent that could not be read.
        factory.Hevy.WorkoutPages[key] = page => HevyResult<HevyPage<HevyWorkout>>.Ok(new HevyPage<HevyWorkout>([Workout(10, kept)], page, 1, 1));

        var result = await SyncOkAsync(api);

        Assert.Equal(0, result.Deleted);
        Assert.Null((await SessionAsync(api, unsure)).DeletedAt);
    }

    [Theory]
    [InlineData("put")]
    [InlineData("patch")]
    public async Task A_put_or_patch_while_a_run_goes_on_keeps_the_run_from_setting_a_cursor(string edit)
    {
        var (api, _) = await UserWithPlanAsync(factory);
        using var _api = api;
        var key = NewKey();
        await ConnectAsync(api, key);
        factory.Hevy.WorkoutPages[key] = Pages(1, [Workout(10)]);
        var gate = (Entered: new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously), Release: new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
        factory.Hevy.Gates[key] = gate;
        try
        {
            var run = api.Client.PostAsync(SyncUrl, null);
            await gate.Entered.Task.WaitAsync(Wait);

            if (edit == "put")
                await ConnectAsync(api, key);
            else
                await PatchSyncFromAsync(api, SyncFrom);

            gate.Release.SetResult();
            Assert.Equal(HttpStatusCode.OK, (await run.WaitAsync(Wait)).StatusCode);
        }
        finally
        {
            gate.Release.TrySetResult();
            factory.Hevy.Gates.TryRemove(key, out _);
        }

        var row = await RowAsync(api);
        Assert.Null(row.Cursor);
        Assert.NotNull(row.LastSuccessAt);
        Assert.Null(row.LastError);
        Assert.Equal(1, await LiveSessionsAsync(api));
    }
}
