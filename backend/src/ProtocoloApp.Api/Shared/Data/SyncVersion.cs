using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace ProtocoloApp.Api.Shared.Data;

/// <summary>
/// The global sync version (Postgres sequence <c>sync_version_seq</c>) and the per-user lock that makes it safe to pull by.
/// </summary>
/// <remarks>
/// Pull returns rows with <c>version &gt; since</c> and the client moves <c>since</c> to the highest version it saw. That is
/// only correct if, for a given user, a version is never committed after a higher one became visible. Sequences do not
/// guarantee that across concurrent transactions, so every write of a user's sync rows takes <see cref="LockUserAsync"/>
/// first and calls <see cref="NextAsync"/> inside that transaction: the user's writes commit in version order.
/// </remarks>
public static class SyncVersion
{
    public const string SequenceName = "sync_version_seq";

    /// <summary>The next global version. Call it inside the transaction that holds <see cref="LockUserAsync"/>.</summary>
    public static async Task<long> NextAsync(AppDbContext db, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(db);

        await db.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = $"SELECT nextval('{SequenceName}')";
            command.Transaction = db.Database.CurrentTransaction?.GetDbTransaction();
            var value = await command.ExecuteScalarAsync(cancellationToken);
            return Convert.ToInt64(value, CultureInfo.InvariantCulture);
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    /// <summary>
    /// Serializes the sync writes of one user until the current transaction ends (<c>pg_advisory_xact_lock</c>).
    /// </summary>
    /// <exception cref="InvalidOperationException">There is no current transaction (the lock would be released at once).</exception>
    public static async Task LockUserAsync(AppDbContext db, Guid userId, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(db);
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("The user's sync lock must be taken inside a transaction.");

        var key = userId.ToString();
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({key}))", cancellationToken);
    }
}
