using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using ProtocoloApp.Api.Features.ExerciseCatalog;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.ExerciseCatalog;

public sealed class ExerciseCatalogSyncTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset Now = new(2026, 10, 20, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Serves scripted pages by cursor and records the cursors it was asked for.</summary>
    private sealed class FakeClient(Func<string?, ExerciseDbPage?> respond) : IExerciseDbClient
    {
        public List<string?> Cursors { get; } = [];

        public Task<ExerciseDbPage?> GetPageAsync(string? after, CancellationToken ct)
        {
            Cursors.Add(after);
            return Task.FromResult(respond(after));
        }
    }

    private static ExerciseDbItem Item(string id, string? gif = null, string name = "")
        => new(id, name.Length == 0 ? $"exercise {id}" : name, gif, ["upper arms"], ["biceps"], ["forearms"], ["cable"]);

    private static ExerciseDbPage Page(string[] ids, string? next) => new(ids.Select(i => Item(i)).ToList(), next is not null, next);

    private ExerciseCatalogSync CreateSync(IExerciseDbClient client, FakeTimeProvider? clock = null, bool enabled = true)
        => new(
            factory.Services.GetRequiredService<IServiceScopeFactory>(),
            client,
            clock ?? new FakeTimeProvider(Now),
            Options.Create(new ExerciseCatalogOptions { Enabled = enabled, PageDelayMilliseconds = 0 }),
            NullLogger<ExerciseCatalogSync>.Instance);

    private async Task<List<CatalogExercise>> RowsAsync()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().CatalogExercises.AsNoTracking().OrderBy(e => e.Id).ToListAsync();
    }

    private async Task<string?> MarkerAsync()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().AppSecrets.AsNoTracking()
            .Where(s => s.Name == ExerciseCatalogSync.SyncedAtKey).Select(s => s.Value).SingleOrDefaultAsync();
    }

    [Fact]
    public async Task Pages_with_the_after_cursor_until_there_is_no_next_page()
    {
        await CatalogData.ResetAsync(factory);
        var client = new FakeClient(after => after switch
        {
            null => Page(["a1", "a2"], "c1"),
            "c1" => Page(["a3"], "c2"),
            "c2" => Page(["a4"], null),
            _ => null,
        });

        var result = await CreateSync(client).SyncAsync(CancellationToken.None);

        Assert.Equal([null, "c1", "c2"], client.Cursors);
        Assert.Equal(new CatalogSyncResult(3, 4, true), result);
        Assert.Equal(["a1", "a2", "a3", "a4"], (await RowsAsync()).Select(r => r.Id));
        Assert.NotNull(await MarkerAsync());
    }

    [Fact]
    public async Task Stops_when_a_page_brings_no_new_id()
    {
        await CatalogData.ResetAsync(factory);
        var client = new FakeClient(after => after switch
        {
            null => Page(["b1", "b2"], "c1"),
            "c1" => Page(["b1", "b2"], "c2"),
            _ => Page(["never"], "c3"),
        });

        var result = await CreateSync(client).SyncAsync(CancellationToken.None);

        Assert.Equal([null, "c1"], client.Cursors);
        Assert.True(result.Complete);
        Assert.Equal(["b1", "b2"], (await RowsAsync()).Select(r => r.Id));
    }

    [Fact]
    public async Task Stops_at_100_pages_even_if_the_api_keeps_going()
    {
        await CatalogData.ResetAsync(factory);
        var n = 0;
        var client = new FakeClient(_ =>
        {
            n++;
            return Page([$"p{n:000}"], $"cursor{n}");
        });

        var result = await CreateSync(client).SyncAsync(CancellationToken.None);

        Assert.Equal(100, client.Cursors.Count);
        Assert.Equal(100, result.Pages);
        Assert.Equal(100, (await RowsAsync()).Count);
    }

    [Fact]
    public async Task Upsert_is_idempotent_and_refreshes_changed_fields()
    {
        await CatalogData.ResetAsync(factory);
        var first = new FakeClient(_ => new ExerciseDbPage([Item("u1", name: "old name"), Item("u2")], false, null));
        await CreateSync(first).SyncAsync(CancellationToken.None);
        var second = new FakeClient(_ => new ExerciseDbPage([Item("u1", name: "new name"), Item("u2")], false, null));
        var later = new FakeTimeProvider(Now.AddDays(40));

        await CreateSync(second, later).SyncAsync(CancellationToken.None);
        await CreateSync(second, later).SyncAsync(CancellationToken.None);

        var rows = await RowsAsync();
        Assert.Equal(2, rows.Count);
        Assert.Equal("new name", rows[0].Name);
        Assert.All(rows, r => Assert.Equal(Now.AddDays(40), r.SyncedAt));
    }

    [Fact]
    public async Task Gif_urls_outside_the_static_host_are_not_stored()
    {
        await CatalogData.ResetAsync(factory);
        // Defense in depth: the client already drops them (ExerciseDbClientTests), the sync checks again.
        var client = new FakeClient(_ => new ExerciseDbPage(
            [
                Item("g1", "https://static.exercisedb.dev/media/g1.gif"),
                Item("g2", "https://evil.example/g2.gif"),
                Item("g3", "http://static.exercisedb.dev/media/g3.gif"),
                Item("g4", "https://static.exercisedb.dev.evil.example/g4.gif"),
            ],
            false,
            null));

        await CreateSync(client).SyncAsync(CancellationToken.None);

        var rows = await RowsAsync();
        Assert.Equal("https://static.exercisedb.dev/media/g1.gif", rows[0].GifUrl);
        Assert.All(rows.Skip(1), r => Assert.Null(r.GifUrl));
    }

    [Fact]
    public async Task A_failed_page_keeps_what_was_saved_and_leaves_the_sync_incomplete()
    {
        await CatalogData.ResetAsync(factory);
        var client = new FakeClient(after => after is null ? Page(["f1"], "c1") : null);
        var sync = CreateSync(client);

        var result = await sync.SyncAsync(CancellationToken.None);

        Assert.False(result.Complete);
        Assert.Single(await RowsAsync());
        Assert.Null(await MarkerAsync());
        Assert.True(await sync.IsDueAsync(CancellationToken.None));
    }

    [Fact]
    public async Task A_page_that_cannot_be_read_on_an_empty_catalog_is_not_a_completed_sync()
    {
        await CatalogData.ResetAsync(factory);
        var client = new FakeClient(_ => null);
        var sync = CreateSync(client);

        var result = await sync.SyncAsync(CancellationToken.None);

        Assert.False(result.Complete);
        Assert.Null(await MarkerAsync());
        Assert.True(await sync.IsDueAsync(CancellationToken.None));
    }

    [Fact]
    public async Task An_empty_answer_on_an_empty_catalog_is_not_a_completed_sync_but_is_on_a_filled_one()
    {
        await CatalogData.ResetAsync(factory);
        var empty = new FakeClient(_ => new ExerciseDbPage([], false, null));

        var first = await CreateSync(empty).SyncAsync(CancellationToken.None);

        Assert.False(first.Complete);
        Assert.Null(await MarkerAsync());

        await CatalogData.SeedAsync(factory, Now.AddDays(-60), "kept");
        var second = await CreateSync(empty).SyncAsync(CancellationToken.None);

        Assert.True(second.Complete);
        Assert.NotNull(await MarkerAsync());
    }

    [Fact]
    public async Task A_run_does_nothing_while_another_holds_the_advisory_lock()
    {
        await CatalogData.ResetAsync(factory);
        await using var scope = factory.Services.CreateAsyncScope();
        var other = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await other.Database.OpenConnectionAsync();
        await using (var command = other.Database.GetDbConnection().CreateCommand())
        {
            command.CommandText = $"select pg_advisory_lock({ExerciseCatalogSync.AdvisoryLockKey})";
            await command.ExecuteScalarAsync();
        }

        var client = new FakeClient(_ => Page(["l1"], null));
        var result = await CreateSync(client).SyncAsync(CancellationToken.None);

        Assert.Empty(client.Cursors);
        Assert.Equal(new CatalogSyncResult(0, 0, false), result);

        await using (var command = other.Database.GetDbConnection().CreateCommand())
        {
            command.CommandText = $"select pg_advisory_unlock({ExerciseCatalogSync.AdvisoryLockKey})";
            await command.ExecuteScalarAsync();
        }

        await CreateSync(client).SyncAsync(CancellationToken.None);
        Assert.Single(await RowsAsync());
    }

    [Fact]
    public async Task Disabled_option_does_nothing()
    {
        await CatalogData.ResetAsync(factory);
        var client = new FakeClient(_ => Page(["d1"], null));
        using var sync = CreateSync(client, enabled: false);

        await sync.StartAsync(CancellationToken.None);
        await sync.ExecuteTask!;
        await sync.StopAsync(CancellationToken.None);

        Assert.Empty(client.Cursors);
        Assert.Empty(await RowsAsync());
    }

    [Fact]
    public async Task Start_syncs_when_the_catalog_is_empty()
    {
        await CatalogData.ResetAsync(factory);
        var client = new FakeClient(_ => Page(["s1"], null));
        using var sync = CreateSync(client);

        await sync.StartAsync(CancellationToken.None);
        await sync.ExecuteTask!;
        await sync.StopAsync(CancellationToken.None);

        Assert.Single(client.Cursors);
        Assert.Single(await RowsAsync());
    }

    [Fact]
    public async Task Start_does_nothing_when_the_last_sync_is_recent_and_syncs_again_when_older_than_30_days()
    {
        await CatalogData.ResetAsync(factory);
        await CreateSync(new FakeClient(_ => Page(["r1"], null))).SyncAsync(CancellationToken.None);

        Assert.False(await CreateSync(new FakeClient(_ => null), new FakeTimeProvider(Now.AddDays(29))).IsDueAsync(CancellationToken.None));
        Assert.True(await CreateSync(new FakeClient(_ => null), new FakeTimeProvider(Now.AddDays(31))).IsDueAsync(CancellationToken.None));
    }

    [Fact]
    public async Task A_client_that_throws_never_crashes_the_host_loop()
    {
        await CatalogData.ResetAsync(factory);
        var client = new FakeClient(_ => throw new InvalidOperationException("boom"));
        using var sync = CreateSync(client);

        await sync.StartAsync(CancellationToken.None);
        await sync.ExecuteTask!;
        await sync.StopAsync(CancellationToken.None);

        Assert.True(sync.ExecuteTask!.IsCompletedSuccessfully);
    }
}
