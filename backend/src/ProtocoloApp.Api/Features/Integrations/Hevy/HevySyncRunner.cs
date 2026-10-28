using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Features.Integrations.Secrets;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Features.Workouts;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>
/// How one run ended: <see cref="Result"/> when it read Hevy to the end without error; otherwise <see cref="Error"/> (a stored
/// error code such as <c>rate_limited</c>, or <see cref="NotConfigured"/>/<see cref="NotConnected"/>), or
/// <see cref="AlreadyRunning"/>. A run stopped by the page cap has both: the counts of what it imported and
/// <see cref="Incomplete"/>.
/// </summary>
public sealed record HevyRunResult(HevySyncResult? Result, string? Error, bool AlreadyRunning)
{
    public const string NotConfigured = "not_configured";
    public const string NotConnected = "not_connected";
    public const string KeyUnreadable = "key_unreadable";

    /// <summary>The run hit <see cref="HevyClient.MaxPagesPerRun"/>: what it read is imported, the cursor stays.</summary>
    public const string Incomplete = "incomplete";

    /// <summary>An unexpected failure of the server (not of Hevy) during the import; the cursor stays.</summary>
    public const string Internal = "internal";
}

/// <summary>
/// One Hevy sync run of a user (spec "Hevy", section 3), shared by the scheduler and "Sincronizar agora":
/// <list type="bullet">
/// <item>a session advisory lock (<see cref="HevySyncLock"/>) on a dedicated connection keeps two runs of the same user apart;</item>
/// <item>without a cursor, the initial load reads <c>/v1/workouts</c> (newest first) until a page is wholly before
/// <c>sync_from</c>, the last page (<c>page_count</c>), or <see cref="HevyClient.MaxPagesPerRun"/>. When it ends before the cap
/// with every item readable, the live Hevy sessions from <c>sync_from</c> on that it did not see were deleted in Hevy meanwhile
/// (the cursor had been reset, so no <c>deleted</c> event reaches them): they are removed as a <c>deleted</c> event would;</item>
/// <item>with a cursor, it reads <c>/v1/workouts/events?since=cursor</c> up to <c>page_count</c> (same cap; a page of only
/// unknown event types does not end it);</item>
/// <item>templates are fetched only when a new exercise needs its muscle group, cached for the run, never inside a write
/// transaction;</item>
/// <item>any Hevy error stops the run and is stored in <c>last_error</c>; what was imported stays (idempotent) but the cursor only
/// moves after a run without error, to its start minus <see cref="CursorSlack"/>, and only when no <c>PUT</c>/<c>PATCH</c>
/// changed the connection meanwhile;</item>
/// <item>a run stopped by the cap keeps the cursor (Hevy does not document the order of events, so no later point is known to
/// be safe) and stores <see cref="HevyRunResult.Incomplete"/>. The next run reads the same pages again (idempotent, nothing is
/// lost) but cannot get past the cap: the way out is a later start date ("Mudar data inicial"), which the status asks for;</item>
/// <item>an unexpected exception is stored as <see cref="HevyRunResult.Internal"/> (cursor kept) and logged by type only.</item>
/// </list>
/// Logs counts and error codes only.
/// </summary>
public sealed class HevySyncRunner(
    AppDbContext db,
    IHevyClient hevy,
    ISecretProtector protector,
    IZoneProvider zones,
    TimeProvider clock,
    ILogger<HevySyncRunner> logger)
{
    /// <summary>Margin taken off the cursor, so a workout saved in Hevy while a run was going is read again next time.</summary>
    public static readonly TimeSpan CursorSlack = TimeSpan.FromMinutes(5);

    public async Task<HevyRunResult> RunAsync(Guid userId, CancellationToken ct)
    {
        if (!protector.IsConfigured)
            return new HevyRunResult(null, HevyRunResult.NotConfigured, false);

        var connectionString = db.Database.GetConnectionString()
            ?? throw new InvalidOperationException("The database connection string is missing.");
        await using var held = await HevySyncLock.TryAcquireAsync(connectionString, userId, ct);
        if (held is null)
        {
            logger.RunLocked();
            return new HevyRunResult(null, null, true);
        }

        var connection = await db.HevyConnections.AsNoTracking().SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (connection is null)
            return new HevyRunResult(null, HevyRunResult.NotConnected, false);

        var startedAt = clock.GetUtcNow();
        await UpdateConnectionAsync(userId, c => c.LastAttemptAt = startedAt, ct);

        var key = HevyConnections.ReadKey(connection, protector);
        if (key is null)
        {
            await UpdateConnectionAsync(userId, c => c.LastError = HevyRunResult.KeyUnreadable, ct);
            logger.RunFailed(HevyRunResult.KeyUnreadable, 0);
            return new HevyRunResult(null, HevyRunResult.KeyUnreadable, false);
        }

        try
        {
            return await ImportAsync(userId, connection, key, startedAt, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // Only the type: messages of database errors may carry values. The importer already rolled back its transaction.
            logger.RunCrashed(ex.GetType().Name);
            await UpdateConnectionAsync(userId, c => c.LastError = HevyRunResult.Internal, ct);
            return new HevyRunResult(null, HevyRunResult.Internal, false);
        }
    }

    private async Task<HevyRunResult> ImportAsync(Guid userId, HevyConnection connection, string key, DateTimeOffset startedAt, CancellationToken ct)
    {
        // PUT and PATCH change UpdatedAt (and reset the cursor): a run that overlapped them must not set a cursor of its own.
        var edition = connection.UpdatedAt;
        var templates = new TemplateLookup(hevy, key, clock, logger, ct);
        var ctx = new ImportContext(connection.SyncFrom, zones.Zone, clock, templates.GroupAsync);
        var pass = connection.Cursor is { } cursor
            ? await ReadEventsAsync(userId, key, cursor, ctx, ct)
            : await ReadWorkoutsAsync(userId, key, ctx, ct);

        if (pass.Error is { } error)
        {
            var code = HevyConnections.ErrorCode(error);
            await UpdateConnectionAsync(userId, c => c.LastError = code, ct);
            logger.RunFailed(code, pass.Pages);
            return new HevyRunResult(null, code, false);
        }

        if (pass.Seen is { } seen && !pass.Capped && pass.SkippedItems == 0 && await EditionAsync(userId, ct) == edition)
            await RemoveUnseenAsync(userId, seen, ctx, ct);

        var pending = await HevyImporter.PendingExercisesAsync(db, userId, ct);
        var result = ctx.ToResult(pending);
        var finishedAt = clock.GetUtcNow();
        await UpdateConnectionAsync(userId, c =>
        {
            c.LastResult = HevyConnections.WriteResult(result);
            if (pass.Capped)
            {
                c.LastError = HevyRunResult.Incomplete;
                return;
            }

            c.LastSuccessAt = finishedAt;
            c.LastError = null;
            if (c.UpdatedAt == edition)
                c.Cursor = startedAt - CursorSlack;
        }, ct);
        logger.RunFinished(
            pass.Pages, result.Imported, result.Updated, result.Deleted, result.Unchanged, result.SkippedNoPlan, result.SkippedSets,
            pass.SkippedItems, pending, pass.Capped);
        return new HevyRunResult(result, pass.Capped ? HevyRunResult.Incomplete : null, false);
    }

    /// <summary><c>Seen</c>: the ids of every workout the initial load read (null for an incremental run).</summary>
    private sealed record Pass(int Pages, HevyError? Error, int SkippedItems, bool Capped, HashSet<string>? Seen = null);

    /// <summary>The initial load: pages of workouts (newest first) until one is wholly before <c>sync_from</c>.</summary>
    private async Task<Pass> ReadWorkoutsAsync(Guid userId, string key, ImportContext ctx, CancellationToken ct)
    {
        var pages = 0;
        var skipped = 0;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var page = 1; page <= HevyClient.MaxPagesPerRun; page++)
        {
            if (page > 1)
                await Task.Delay(HevyClient.PageDelay, clock, ct);

            var response = await hevy.GetWorkoutsAsync(key, page, ct);
            if (response.Value is not { } value)
                return new Pass(pages, response.Error ?? HevyError.Format, skipped, false);

            pages++;
            skipped += value.Skipped;
            var allBefore = value.Items.Count > 0;
            foreach (var workout in value.Items)
            {
                seen.Add(workout.Id);
                var outcome = ctx.Count(await HevyImporter.ApplyUpdatedAsync(db, userId, workout, ctx, ct));
                if (outcome != ImportOutcome.SkippedBeforeSyncFrom)
                    allBefore = false;
            }

            if (allBefore || page >= value.PageCount)
                return new Pass(pages, null, skipped, false, seen);
        }

        return new Pass(pages, null, skipped, true, seen);
    }

    /// <summary>The incremental run: every page of events since the cursor, up to <c>page_count</c>.</summary>
    private async Task<Pass> ReadEventsAsync(Guid userId, string key, DateTimeOffset since, ImportContext ctx, CancellationToken ct)
    {
        var pages = 0;
        var skipped = 0;
        for (var page = 1; page <= HevyClient.MaxPagesPerRun; page++)
        {
            if (page > 1)
                await Task.Delay(HevyClient.PageDelay, clock, ct);

            var response = await hevy.GetEventsAsync(key, since, page, ct);
            if (response.Value is not { } value)
                return new Pass(pages, response.Error ?? HevyError.Format, skipped, false);

            pages++;
            skipped += value.Skipped;
            foreach (var ev in value.Items)
            {
                if (ev.Type == HevyEvent.Updated && ev.Workout is { } workout)
                    ctx.Count(await HevyImporter.ApplyUpdatedAsync(db, userId, workout, ctx, ct));
                else if (ev.Type == HevyEvent.Deleted && ev.DeletedId is { } deletedId)
                    ctx.Count(await HevyImporter.ApplyDeletedAsync(db, userId, deletedId, ctx, ct));
                else
                    skipped++;
            }

            // Not on an empty page: one with only event types we skip is empty but not the last.
            if (page >= value.PageCount)
                return new Pass(pages, null, skipped, false);
        }

        return new Pass(pages, null, skipped, true);
    }

    /// <summary>
    /// After a whole initial load: the live Hevy sessions from <c>sync_from</c> on whose workout was not in Hevy's list are
    /// removed as a <c>deleted</c> event removes them (sets, and the day's workout mark recomputed). Sessions deleted in the
    /// app are not live, so they stay as they are.
    /// </summary>
    private async Task RemoveUnseenAsync(Guid userId, HashSet<string> seen, ImportContext ctx, CancellationToken ct)
    {
        var live = await db.WorkoutSessions.AsNoTracking()
            .Where(s => s.UserId == userId && s.Source == SessionSource.Hevy && s.DeletedAt == null && s.Date >= ctx.SyncFrom
                && s.ExternalId != null)
            .Select(s => s.ExternalId!)
            .ToListAsync(ct);
        foreach (var externalId in live.Where(id => !seen.Contains(id)))
            ctx.Count(await HevyImporter.ApplyDeletedAsync(db, userId, externalId, ctx, ct));
    }

    /// <summary>The connection's <c>UpdatedAt</c> now (null when it was removed).</summary>
    private Task<DateTimeOffset?> EditionAsync(Guid userId, CancellationToken ct) =>
        db.HevyConnections.AsNoTracking().Where(c => c.UserId == userId).Select(c => (DateTimeOffset?)c.UpdatedAt).SingleOrDefaultAsync(ct);

    /// <summary>Writes the run's state on a fresh row (the importer may have cleared the change tracker); no-op when it was removed.</summary>
    private async Task UpdateConnectionAsync(Guid userId, Action<HevyConnection> apply, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var row = await db.HevyConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (row is null)
            return;

        apply(row);
        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
    }

    /// <summary>
    /// The <c>primary_muscle_group</c> of a template, reading the template pages lazily (and only once per run). A failed page
    /// stops the lookup: the exercise gets the "other" group, the import goes on.
    /// </summary>
    private sealed class TemplateLookup(IHevyClient hevy, string key, TimeProvider clock, ILogger logger, CancellationToken ct)
    {
        private readonly Dictionary<string, string?> _groups = new(StringComparer.Ordinal);
        private int _nextPage = 1;
        private bool _done;

        public async Task<string?> GroupAsync(string templateId)
        {
            string? group;
            while (!_groups.TryGetValue(templateId, out group))
            {
                if (_done)
                    return null;
                if (_nextPage > 1)
                    await Task.Delay(HevyClient.PageDelay, clock, ct);

                var response = await hevy.GetTemplatesAsync(key, _nextPage, ct);
                if (response.Value is not { } value)
                {
                    _done = true;
                    logger.TemplatesFailed(HevyConnections.ErrorCode(response.Error ?? HevyError.Format));
                    return null;
                }

                foreach (var template in value.Items)
                    _groups.TryAdd(template.Id, template.PrimaryMuscleGroup);
                if (value.Items.Count == 0 || _nextPage >= value.PageCount || _nextPage >= HevyClient.MaxPagesPerRun)
                    _done = true;
                _nextPage++;
            }

            return group;
        }
    }
}

/// <summary>
/// The per-user run lock: a session advisory lock on <c>hashtext('hevy:' || userId)</c>, held on a connection of its own for the
/// whole run (the importer's transactions come and go on the context's connection). Released on dispose; a dropped connection
/// releases it too.
/// </summary>
public sealed class HevySyncLock : IAsyncDisposable
{
    private readonly NpgsqlConnection _connection;
    private readonly string _key;

    private HevySyncLock(NpgsqlConnection connection, string key)
    {
        _connection = connection;
        _key = key;
    }

    public static string Key(Guid userId) => $"hevy:{userId}";

    /// <summary>The held lock, or null when another run of the user holds it.</summary>
    public static async Task<HevySyncLock?> TryAcquireAsync(string connectionString, Guid userId, CancellationToken ct)
    {
        var key = Key(userId);
        var connection = new NpgsqlConnection(connectionString);
        try
        {
            await connection.OpenAsync(ct);
            await using var command = new NpgsqlCommand("SELECT pg_try_advisory_lock(hashtext(@key))", connection);
            command.Parameters.AddWithValue("key", key);
            if (await command.ExecuteScalarAsync(ct) is true)
                return new HevySyncLock(connection, key);
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }

        await connection.DisposeAsync();
        return null;
    }

    /// <summary>Whether a run of the user holds the lock now (any connection of this database).</summary>
    public static Task<bool> IsHeldAsync(AppDbContext db, Guid userId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);

        // A bigint key shows in pg_locks as classid = high 32 bits, objid = low 32 bits, objsubid = 1.
        var key = Key(userId);
        return db.Database.SqlQuery<bool>($"""
            SELECT EXISTS (
                SELECT 1 FROM pg_locks l
                WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 1
                  AND l.database = (SELECT d.oid FROM pg_database d WHERE d.datname = current_database())
                  AND l.classid = ((hashtext({key})::bigint >> 32) & 4294967295)::oid
                  AND l.objid = (hashtext({key})::bigint & 4294967295)::oid
            ) AS "Value"
            """).SingleAsync(ct);
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            await using var command = new NpgsqlCommand("SELECT pg_advisory_unlock(hashtext(@key))", _connection);
            command.Parameters.AddWithValue("key", _key);
            await command.ExecuteScalarAsync(CancellationToken.None);
        }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException)
        {
            // A broken connection already released the lock.
        }
        finally
        {
            await _connection.DisposeAsync();
        }
    }
}

/// <summary><c>POST /api/integrations/hevy/sync</c>: "Sincronizar agora".</summary>
public static class HevySyncEndpoints
{
    public const string AlreadyRunningMessage = "Sincronização já em andamento.";

    public const string NotConnectedMessage = "Nenhuma conexão com o Hevy.";

    public const string IncompleteMessage = "Há treinos demais para buscar de uma vez. Escolha uma data inicial mais recente.";

    public static void MapHevySyncEndpoints(this RouteGroupBuilder group)
    {
        ArgumentNullException.ThrowIfNull(group);

        group.MapPost("/sync", SyncAsync);
    }

    /// <summary>
    /// Runs a sync now. 409 while another run of the user goes on (the scheduler's included), 404 without a connection, 503 when
    /// the server has no encryption key, 502 with <c>lastError</c> when Hevy failed (the cursor stays).
    /// </summary>
    private static async Task<Results<Ok<HevySyncResult>, ProblemHttpResult>> SyncAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        ISecretProtector protector,
        HevySyncRunner runner,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(protector);
        ArgumentNullException.ThrowIfNull(runner);

        if (!protector.IsConfigured)
            return NotConfigured();

        var userId = principal.GetUserId();
        if (!await db.HevyConnections.AnyAsync(c => c.UserId == userId, ct))
            return NotConnected();

        var run = await runner.RunAsync(userId, ct);
        if (run.AlreadyRunning)
            return TypedResults.Problem(title: "Sincronização em andamento", detail: AlreadyRunningMessage, statusCode: StatusCodes.Status409Conflict);
        if (run.Result is { } result)
            return TypedResults.Ok(result);

        return run.Error switch
        {
            HevyRunResult.NotConfigured => NotConfigured(),
            HevyRunResult.NotConnected or null => NotConnected(),
            { } code => TypedResults.Problem(
                title: "Falha na sincronização",
                detail: ErrorMessage(code),
                statusCode: StatusCodes.Status502BadGateway,
                extensions: new Dictionary<string, object?> { ["lastError"] = code }),
        };
    }

    /// <summary>The pt-BR message of a stored error code.</summary>
    public static string ErrorMessage(string code) => code switch
    {
        "unauthorized" => HevyConnectionEndpoints.RejectedKeyMessage,
        "rate_limited" => "O Hevy limitou as chamadas. Tente de novo em alguns minutos.",
        "format" => "O Hevy respondeu num formato inesperado. Tente de novo mais tarde.",
        HevyRunResult.KeyUnreadable => HevyConnectionEndpoints.KeyUnreadableMessage,
        HevyRunResult.Incomplete => IncompleteMessage,
        HevyRunResult.Internal => "Erro inesperado ao importar do Hevy. Tente de novo mais tarde.",
        _ => HevyConnectionEndpoints.UnavailableMessage,
    };

    private static ProblemHttpResult NotConfigured() =>
        TypedResults.Problem(title: "Hevy não configurado", detail: HevyConnectionEndpoints.NotConfiguredMessage, statusCode: StatusCodes.Status503ServiceUnavailable);

    private static ProblemHttpResult NotConnected() =>
        TypedResults.Problem(title: "Hevy não conectado", detail: NotConnectedMessage, statusCode: StatusCodes.Status404NotFound);
}
