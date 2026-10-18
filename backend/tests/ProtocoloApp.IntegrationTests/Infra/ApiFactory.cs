using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.Api.Shared.Storage;

namespace ProtocoloApp.IntegrationTests.Infra;

/// <summary>
/// The whole API against a real Postgres (<see cref="PostgresFixture"/>), shared by the <c>api</c> collection.
/// Each test creates its own data, so nobody cleans up.
/// </summary>
/// <remarks>
/// The auth endpoints are rate limited per client IP (5 per minute), and the limiter lives as long as the factory. Clients
/// from <see cref="CreateClientWithOwnIp"/> send a distinct <c>X-Forwarded-For</c> (the API trusts it, like behind the real
/// proxy), so each test has its own bucket and tests cannot make each other flaky.
/// </remarks>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string DefaultPassword = "Senha-de-teste-123";

    private static int _ipCounter;

    private readonly PostgresFixture _postgres = new();

    /// <summary>The storage every test talks to: no R2 settings are needed because this replaces the real one.</summary>
    public FakeFileStorage Storage { get; } = new();

    public string ConnectionString => _postgres.ConnectionString;

    public async Task InitializeAsync()
    {
        await _postgres.InitializeAsync();

        // Same path production takes (the migrations bundle), minus the bundle itself.
        await using var scope = Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    }

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
        builder.UseSetting("Auth:SigningKey", "test-only-signing-key-0123456789-abcdefghij");
        builder.ConfigureTestServices(services => services.Replace(ServiceDescriptor.Singleton<IFileStorage>(Storage)));
    }

    /// <summary>A client whose requests come from an IP no other client of this factory uses (own rate-limit bucket).</summary>
    public HttpClient CreateClientWithOwnIp()
    {
        var n = Interlocked.Increment(ref _ipCounter);
        var client = CreateClient();
        client.DefaultRequestHeaders.Add("X-Forwarded-For", $"10.{(n >> 16) & 255}.{(n >> 8) & 255}.{n & 255}");
        return client;
    }

    /// <summary>Creates the user when it does not exist yet (the CLI does the same in production).</summary>
    public async Task CreateUserAsync(string email, string password = DefaultPassword)
    {
        await using var scope = Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        if (await users.FindByEmailAsync(email) is not null)
            return;

        var result = await users.CreateAsync(new AppUser { UserName = email, Email = email, EmailConfirmed = true }, password);
        Assert.True(result.Succeeded, string.Join("; ", result.Errors.Select(e => e.Description)));
    }

    /// <summary>A client already logged in as <paramref name="email"/> (created on demand), with its own IP.</summary>
    public async Task<HttpClient> CreateAuthenticatedClientAsync(string email = "teste@example.com")
    {
        await CreateUserAsync(email);

        var client = CreateClientWithOwnIp();
        var response = await client.PostAsJsonAsync(new Uri("/api/auth/login", UriKind.Relative), new LoginRequest(email, DefaultPassword));
        response.EnsureSuccessStatusCode();
        var tokens = await response.Content.ReadFromJsonAsync<TokenResponse>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens!.AccessToken);
        return client;
    }
}
