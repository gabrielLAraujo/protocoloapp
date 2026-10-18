using System.Security.Claims;
using FluentValidation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Sync;

/// <summary>
/// <c>POST /api/sync/push</c>: applies a batch of client changes, idempotently and one by one. A malformed batch is a 400;
/// otherwise every change gets its own result and a rejected change never undoes the others.
/// </summary>
/// <remarks>
/// Database failures other than constraint violations (connection lost, timeout) fail the whole request with 500: nothing
/// is committed and the client retries the batch, which is safe because replays come back <c>stale</c>.
/// </remarks>
public static class PushEndpoint
{
    /// <summary>How far ahead of the server clock a client timestamp may be.</summary>
    public static readonly TimeSpan MaxClockSkew = TimeSpan.FromMinutes(5);

    private const string Savepoint = "sync_change";

    public static async Task<Results<Ok<SyncPushResponse>, ValidationProblem>> HandleAsync(
        SyncPushRequest? request,
        IValidator<SyncPushRequest> validator,
        ClaimsPrincipal principal,
        AppDbContext db,
        SyncHandlerRegistry handlers,
        TimeProvider clock,
        ILoggerFactory loggers,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(validator);
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(handlers);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(loggers);

        if (request is null)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["body"] = ["Corpo da requisição inválido."] });

        var validation = await validator.ValidateAsync(request, ct);
        if (!validation.IsValid)
            return TypedResults.ValidationProblem(validation.ToDictionary());

        var userId = principal.GetUserId();
        var logger = loggers.CreateLogger(typeof(PushEndpoint));
        var latestAccepted = clock.GetUtcNow() + MaxClockSkew;
        var results = new List<SyncChangeResult>(request.Changes.Count);

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await SyncVersion.LockUserAsync(db, userId, ct);

        foreach (var sent in request.Changes)
        {
            var change = sent with { ClientUpdatedAt = Normalize(sent.ClientUpdatedAt) };
            var result = await ApplyAsync(change, userId, latestAccepted, db, transaction, handlers, ct);
            results.Add(result);
            logger.ChangeProcessed(change.Entity, change.Id, result.Status, result.Errors is null ? "" : string.Join(',', result.Errors));
        }

        await transaction.CommitAsync(ct);

        logger.PushProcessed(
            results.Count,
            results.Count(r => r.Status == SyncResultStatus.Applied),
            results.Count(r => r.Status == SyncResultStatus.Stale),
            results.Count(r => r.Status == SyncResultStatus.Rejected));
        return TypedResults.Ok(new SyncPushResponse(results));
    }

    private static async Task<SyncChangeResult> ApplyAsync(
        SyncChange change,
        Guid userId,
        DateTimeOffset latestAccepted,
        AppDbContext db,
        IDbContextTransaction transaction,
        SyncHandlerRegistry handlers,
        CancellationToken ct)
    {
        var handler = handlers.Find(change.Entity);
        if (handler is null)
            return SyncChangeResult.Rejected(change.Id, SyncErrors.UnknownEntity);

        // A device clock running ahead would otherwise win every last-write-wins comparison from now on.
        if (change.ClientUpdatedAt > latestAccepted)
            return SyncChangeResult.Rejected(change.Id, SyncErrors.ClientUpdatedAtInFuture);

        await transaction.CreateSavepointAsync(Savepoint, ct);
        SyncChangeResult result;
        try
        {
            result = await handler.ApplyAsync(change, userId, ct);
        }
        catch (DbUpdateException ex) when (IsConstraintViolation(ex))
        {
            result = SyncChangeResult.Rejected(change.Id, SyncErrors.ConstraintViolation);
        }

        if (result.Status == SyncResultStatus.Rejected)
            await transaction.RollbackToSavepointAsync(Savepoint, ct);
        else
            await transaction.ReleaseSavepointAsync(Savepoint, ct);

        // Whatever the handler tracked (including entities a failed SaveChanges left as Added/Modified) belongs to this
        // change only: the next one starts clean, and a 500-change batch does not accumulate 500 tracked rows.
        db.ChangeTracker.Clear();
        return result;
    }

    private static bool IsConstraintViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation
                or PostgresErrorCodes.CheckViolation
                or PostgresErrorCodes.ForeignKeyViolation
                or PostgresErrorCodes.NotNullViolation
                or PostgresErrorCodes.StringDataRightTruncation
                or PostgresErrorCodes.NumericValueOutOfRange
        };

    /// <summary>
    /// UTC, truncated to microseconds: what Postgres stores. Comparing the raw value (100 ns ticks) with the stored one would
    /// make an exact replay look newer than itself.
    /// </summary>
    internal static DateTimeOffset Normalize(DateTimeOffset value)
    {
        var ticks = value.UtcTicks;
        return new DateTimeOffset(ticks - (ticks % TimeSpan.TicksPerMicrosecond), TimeSpan.Zero);
    }
}

public sealed class SyncPushRequestValidator : AbstractValidator<SyncPushRequest>
{
    public const int MaxChanges = 500;
    public const int MaxEntityLength = 64;

    public SyncPushRequestValidator()
    {
        RuleFor(r => r.Changes)
            .NotNull().WithMessage("Informe a lista de mudanças.")
            .Must(c => c is null || c.Count <= MaxChanges).WithMessage($"No máximo {MaxChanges} mudanças por lote.");

        RuleForEach(r => r.Changes)
            .NotNull()
            .ChildRules(change =>
            {
                change.RuleFor(c => c.Entity).NotEmpty().MaximumLength(MaxEntityLength);
                change.RuleFor(c => c.Id).NotEmpty();
                change.RuleFor(c => c.Op).IsInEnum();
                change.RuleFor(c => c.ClientUpdatedAt).NotEqual(default(DateTimeOffset));
            });
    }
}
