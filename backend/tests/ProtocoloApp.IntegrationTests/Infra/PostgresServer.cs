using Npgsql;
using Testcontainers.PostgreSql;

namespace ProtocoloApp.IntegrationTests.Infra;

/// <summary>
/// One real Postgres 18 container for the whole test run, started on first use. Every <see cref="ApiFactory"/> gets a database
/// of its own in it, so test classes run in parallel without seeing each other's data.
/// </summary>
/// <remarks>
/// Nothing stops the container explicitly: Testcontainers' resource reaper removes it when the test process exits.
/// </remarks>
internal static class PostgresServer
{
    // Room for the connection pools of the factories that are alive at the same time (each class keeps its own pool).
    private static readonly PostgreSqlContainer Container = new PostgreSqlBuilder("postgres:18")
        .WithCommand("-c", "max_connections=300")
        .Build();

    private static readonly Lazy<Task> Started = new(() => Container.StartAsync(), LazyThreadSafetyMode.ExecutionAndPublication);

    private static int _databaseCounter;

    /// <summary>Creates an empty database and returns its connection string.</summary>
    public static async Task<string> CreateDatabaseAsync()
    {
        await Started.Value;

        var name = $"test_{Interlocked.Increment(ref _databaseCounter)}";
        await using (var connection = new NpgsqlConnection(Container.GetConnectionString()))
        {
            await connection.OpenAsync();
            await using var command = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", connection);
            await command.ExecuteNonQueryAsync();
        }

        return new NpgsqlConnectionStringBuilder(Container.GetConnectionString()) { Database = name }.ConnectionString;
    }
}
