using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Auth;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Sync;

public sealed class ConcurrencyTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    // Long enough for an unblocked push to finish many times over; the blocked one can never finish within it.
    private static readonly TimeSpan BlockedWait = TimeSpan.FromMilliseconds(500);

    /// <summary>
    /// A pull that advances <c>since</c> past a version whose transaction has not committed yet would skip that record
    /// forever. A raw transaction plays a slow writer: it holds the user's sync lock and an uncommitted row with version v1.
    /// A push for the same user must wait for it (so it cannot commit a higher version first), and a pull meanwhile must
    /// not move past v1. After the commit, a pull from the old cursor returns both rows.
    /// </summary>
    [Fact]
    public async Task Concurrent_pushes_never_lose_records_on_pull()
    {
        var email = AuthApi.NewEmail();
        using var client = await factory.CreateAuthenticatedClientAsync(email);
        var userId = await UserIdAsync(email);
        var slowId = Guid.NewGuid();
        var pushedId = Guid.NewGuid();

        await using var connection = new NpgsqlConnection(factory.ConnectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await ExecuteAsync(connection, transaction, "SELECT pg_advisory_xact_lock(hashtext(@key))", ("key", userId.ToString()));
        var v1 = await NextVersionAsync(connection, transaction);
        await InsertCheckinAsync(connection, transaction, slowId, userId, v1, new DateOnly(2026, 5, 1));

        var push = SyncApi.PushOneAsync(client, SyncApi.Checkin(pushedId, new DateOnly(2026, 5, 2), SyncApi.Past()));
        Assert.NotSame(push, await Task.WhenAny(push, Task.Delay(BlockedWait)));

        var during = await SyncApi.PullAsync(client, 0);
        Assert.Empty(during.Records);
        Assert.True(during.NextSince < v1, $"NextSince {during.NextSince} moved past the uncommitted version {v1}.");

        await transaction.CommitAsync();
        var result = await push;

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var v2 = Assert.Single(await SyncApi.RowsAsync(factory, pushedId)).Version;
        Assert.True(v2 > v1, $"The blocked push got version {v2}, not above the slow writer's {v1}.");
        var after = await SyncApi.PullAsync(client, during.NextSince);
        Assert.Equal(new[] { slowId, pushedId }, after.Records.Select(r => r.Id));
        Assert.Equal(new[] { v1, v2 }, after.Records.Select(r => r.Version));
    }

    private async Task<Guid> UserIdAsync(string email)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var user = await scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>().FindByEmailAsync(email);
        return user!.Id;
    }

    private static async Task<long> NextVersionAsync(NpgsqlConnection connection, NpgsqlTransaction transaction)
    {
        await using var command = new NpgsqlCommand($"SELECT nextval('{SyncVersion.SequenceName}')", connection, transaction);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private static Task InsertCheckinAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, Guid id, Guid userId, long version, DateOnly date)
    {
        var now = DateTimeOffset.UtcNow;
        return ExecuteAsync(
            connection,
            transaction,
            """
            INSERT INTO daily_checkins (id, user_id, version, client_updated_at, deleted_at, created_at, updated_at, date,
                sleep_quality, bowel, energy_wake, energy_day, anxiety, water_l, weight_kg, note)
            VALUES (@id, @user_id, @version, @at, NULL, @at, @at, @date, 3, 'normal', 3, 3, 3, 2.00, NULL, NULL)
            """,
            ("id", id), ("user_id", userId), ("version", version), ("at", now.AddMinutes(-30)), ("date", date));
    }

    private static async Task ExecuteAsync(NpgsqlConnection connection, NpgsqlTransaction transaction, string sql, params (string Name, object Value)[] parameters)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        foreach (var (name, value) in parameters)
            command.Parameters.AddWithValue(name, value);
        await command.ExecuteNonQueryAsync();
    }
}
