using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ProtocoloApp.IntegrationTests.Infra;

/// <summary>
/// The whole API against a real Postgres (<see cref="PostgresFixture"/>), shared by the <c>api</c> collection.
/// Each test creates its own data, so nobody cleans up.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgresFixture _postgres = new();

    public string ConnectionString => _postgres.ConnectionString;

    public Task InitializeAsync() => _postgres.InitializeAsync();

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Db", ConnectionString);
    }
}
