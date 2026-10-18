using Testcontainers.PostgreSql;

namespace ProtocoloApp.IntegrationTests.Infra;

/// <summary>A real Postgres 18 in a container that lives for the whole test run.</summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:18").Build();

    public string ConnectionString => _container.GetConnectionString();

    public Task InitializeAsync() => _container.StartAsync();

    public async Task DisposeAsync() => await _container.DisposeAsync();
}
