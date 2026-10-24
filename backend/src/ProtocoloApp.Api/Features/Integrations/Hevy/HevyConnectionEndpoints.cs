using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Features.Integrations.Secrets;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>
/// The user's connection to Hevy, under <c>/api/integrations/hevy</c>. The API key goes in once (<c>PUT</c>), is stored
/// encrypted and never comes back: not in a response, a problem, nor a log line.
/// </summary>
public static class HevyConnectionEndpoints
{
    public const int MaxApiKeyLength = 200;

    /// <summary>Body cap of the <c>PUT</c> (a key and a date).</summary>
    public const long MaxConnectBodyBytes = 4096;

    public const string NotConfiguredMessage = "Integração com o Hevy não configurada no servidor.";

    public const string RejectedKeyMessage = "O Hevy recusou a chave. Confira a chave e se a conta é Pro.";

    public const string UnavailableMessage = "Não foi possível falar com o Hevy agora. Tente de novo.";

    /// <summary>Maps <c>GET</c>/<c>PUT</c>/<c>PATCH</c>/<c>DELETE</c> on the group root (<c>/integrations/hevy</c>).</summary>
    public static void MapHevyConnectionEndpoints(this RouteGroupBuilder group)
    {
        ArgumentNullException.ThrowIfNull(group);

        group.MapGet("", GetAsync);
        group.MapPut("", ConnectAsync).WithMetadata(new BodySizeLimit(MaxConnectBodyBytes));
        group.MapPatch("", UpdateAsync);
        group.MapDelete("", DeleteAsync);
    }

    private static async Task<Ok<HevyStatusResponse>> GetAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        ISecretProtector protector,
        TimeProvider clock,
        IZoneProvider zones,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(protector);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(zones);

        return TypedResults.Ok(await StatusAsync(db, protector, principal.GetUserId(), Today(clock, zones), ct));
    }

    /// <summary>
    /// Tests the key in Hevy, then stores it encrypted (replacing the previous one) and resets the cursor: the next run
    /// imports from <c>syncFrom</c> again (idempotent). 422 when Hevy refuses the key, 502 when it cannot be reached.
    /// </summary>
    private static async Task<Results<Ok<HevyStatusResponse>, ValidationProblem, ProblemHttpResult>> ConnectAsync(
        ConnectHevyRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        ISecretProtector protector,
        IHevyClient hevy,
        TimeProvider clock,
        IZoneProvider zones,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(protector);
        ArgumentNullException.ThrowIfNull(hevy);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(zones);

        if (!protector.IsConfigured)
            return NotConfigured();

        var today = Today(clock, zones);
        var apiKey = request?.ApiKey?.Trim() ?? "";
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (apiKey.Length is 0 or > MaxApiKeyLength)
            errors["apiKey"] = ["Informe a chave da API do Hevy (até 200 caracteres)."];
        if (request?.SyncFrom is { } from && from > today)
            errors["syncFrom"] = ["A data inicial não pode ser no futuro."];
        if (errors.Count > 0)
            return TypedResults.ValidationProblem(errors);

        switch (await hevy.CheckKeyAsync(apiKey, ct))
        {
            case null:
                break;
            case HevyError.Unauthorized:
                return TypedResults.Problem(new HttpValidationProblemDetails(new Dictionary<string, string[]> { ["apiKey"] = [RejectedKeyMessage] })
                {
                    Title = "Chave recusada",
                    Detail = RejectedKeyMessage,
                    Status = StatusCodes.Status422UnprocessableEntity,
                });
            default:
                return TypedResults.Problem(title: "Hevy indisponível", detail: UnavailableMessage, statusCode: StatusCodes.Status502BadGateway);
        }

        var userId = principal.GetUserId();
        var syncFrom = request!.SyncFrom ?? await HevyConnections.DefaultSyncFromAsync(db, userId, today, ct);
        var cipher = protector.Protect(apiKey, HevyConnections.Purpose(userId));
        var last4 = HevyConnections.Last4(apiKey);
        var now = clock.GetUtcNow();

        // Two first connects at once: the second insert hits the primary key, and is retried as an update.
        for (var attempt = 0; ; attempt++)
        {
            var connection = await db.HevyConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
            if (connection is null)
            {
                connection = new HevyConnection { UserId = userId, CreatedAt = now };
                db.HevyConnections.Add(connection);
            }

            connection.ApiKeyCipher = cipher;
            connection.KeyLast4 = last4;
            connection.SyncFrom = syncFrom;
            connection.Cursor = null;
            connection.LastError = null;
            connection.UpdatedAt = now;
            try
            {
                await db.SaveChangesAsync(ct);
                break;
            }
            catch (DbUpdateException ex) when (attempt == 0 && ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                db.ChangeTracker.Clear();
            }
        }

        return TypedResults.Ok(await StatusAsync(db, protector, userId, today, ct));
    }

    /// <summary>Changes the start date and resets the cursor (the next run reimports from it). 404 without a connection.</summary>
    private static async Task<Results<Ok<HevyStatusResponse>, NotFound, ValidationProblem>> UpdateAsync(
        UpdateHevyRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        ISecretProtector protector,
        TimeProvider clock,
        IZoneProvider zones,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(protector);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(zones);

        var today = Today(clock, zones);
        if (request?.SyncFrom is not { } syncFrom)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["syncFrom"] = ["Informe a data inicial."] });
        if (syncFrom > today)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["syncFrom"] = ["A data inicial não pode ser no futuro."] });

        var userId = principal.GetUserId();
        var connection = await db.HevyConnections.SingleOrDefaultAsync(c => c.UserId == userId, ct);
        if (connection is null)
            return TypedResults.NotFound();

        connection.SyncFrom = syncFrom;
        connection.Cursor = null;
        connection.UpdatedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await StatusAsync(db, protector, userId, today, ct));
    }

    /// <summary>Removes the key and the cursor. Imported workouts and exercise links stay.</summary>
    private static async Task<NoContent> DeleteAsync(ClaimsPrincipal principal, AppDbContext db, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);

        var userId = principal.GetUserId();
        await db.HevyConnections.Where(c => c.UserId == userId).ExecuteDeleteAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<HevyStatusResponse> StatusAsync(AppDbContext db, ISecretProtector protector, Guid userId, DateOnly today, CancellationToken ct)
    {
        var connection = await db.HevyConnections.AsNoTracking().SingleOrDefaultAsync(c => c.UserId == userId, ct);
        var pending = await db.HevyExerciseLinks.CountAsync(l => l.UserId == userId && l.Status == HevyLinkStatus.Pending, ct);
        if (connection is null)
        {
            var proposed = await HevyConnections.DefaultSyncFromAsync(db, userId, today, ct);
            return new HevyStatusResponse(protector.IsConfigured, false, null, proposed, null, null, null, null, false, pending);
        }

        var lastError = protector.IsConfigured && HevyConnections.ReadKey(connection, protector) is null
            ? HevyErrorCode.KeyUnreadable
            : HevyConnections.ParseError(connection.LastError);
        return new HevyStatusResponse(
            protector.IsConfigured,
            true,
            connection.KeyLast4.Length > 0 ? connection.KeyLast4 : null,
            connection.SyncFrom,
            connection.LastAttemptAt,
            connection.LastSuccessAt,
            lastError,
            HevyConnections.ReadResult(connection.LastResult),
            // The run lock arrives with the scheduler (Task 7).
            false,
            pending);
    }

    /// <summary>Read by the endpoint middleware, which lowers the server's body limit for the request (413 above it).</summary>
    private sealed record BodySizeLimit(long? MaxRequestBodySize) : IRequestSizeLimitMetadata;

    private static ProblemHttpResult NotConfigured() =>
        TypedResults.Problem(title: "Hevy não configurado", detail: NotConfiguredMessage, statusCode: StatusCodes.Status503ServiceUnavailable);

    private static DateOnly Today(TimeProvider clock, IZoneProvider zones) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zones.Zone).DateTime);
}
