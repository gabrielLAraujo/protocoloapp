using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Auth;

[Collection("api")]
public sealed class RefreshTests(ApiFactory factory)
{
    private async Task<(HttpClient Client, TokenResponse Tokens)> LoginNewUserAsync()
    {
        var email = AuthApi.NewEmail();
        await factory.CreateUserAsync(email);
        var client = factory.CreateClientWithOwnIp();
        return (client, await AuthApi.LoginOkAsync(client, email, ApiFactory.DefaultPassword));
    }

    [Fact]
    public async Task Refresh_rotates_token()
    {
        var (client, first) = await LoginNewUserAsync();
        using var _ = client;

        var response = await AuthApi.RefreshAsync(client, first.RefreshToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var second = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.NotNull(second);
        Assert.False(string.IsNullOrWhiteSpace(second.AccessToken));
        Assert.NotEqual(first.RefreshToken, second.RefreshToken);

        var replay = await AuthApi.RefreshAsync(client, first.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
    }

    [Fact]
    public async Task Reused_refresh_token_revokes_family()
    {
        var (client, first) = await LoginNewUserAsync();
        using var _ = client;
        var second = await (await AuthApi.RefreshAsync(client, first.RefreshToken)).Content.ReadFromJsonAsync<TokenResponse>();

        // The old token comes back (leaked, or a race between two requests): 401 and the whole family dies.
        var reuse = await AuthApi.RefreshAsync(client, first.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);

        var newest = await AuthApi.RefreshAsync(client, second!.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, newest.StatusCode);
    }

    [Fact]
    public async Task Logout_revokes_family()
    {
        var (client, first) = await LoginNewUserAsync();
        using var _ = client;
        var second = await (await AuthApi.RefreshAsync(client, first.RefreshToken)).Content.ReadFromJsonAsync<TokenResponse>();

        var logout = await AuthApi.LogoutAsync(client, second!.RefreshToken);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        var refresh = await AuthApi.RefreshAsync(client, second.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
    }

    [Fact]
    public async Task Unknown_refresh_token_returns_401()
    {
        using var client = factory.CreateClientWithOwnIp();

        var response = await AuthApi.RefreshAsync(client, "not-a-real-token");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Refresh_tokens_are_stored_hashed()
    {
        var (client, tokens) = await LoginNewUserAsync();
        using var _ = client;

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var expectedHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(tokens.RefreshToken)));

        Assert.False(await db.RefreshTokens.AnyAsync(t => t.TokenHash == tokens.RefreshToken));
        Assert.True(await db.RefreshTokens.AnyAsync(t => t.TokenHash == expectedHash));
    }

    [Fact]
    public async Task Concurrent_refreshes_with_same_token_yield_one_winner_and_revoke_family()
    {
        var (client, first) = await LoginNewUserAsync();
        using var _ = client;

        var responses = await Task.WhenAll(
            AuthApi.RefreshAsync(client, first.RefreshToken),
            AuthApi.RefreshAsync(client, first.RefreshToken));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Unauthorized);

        // The loser counts as a reuse: the winner's new token dies with the family.
        var winner = await responses.Single(r => r.IsSuccessStatusCode).Content.ReadFromJsonAsync<TokenResponse>();
        var next = await AuthApi.RefreshAsync(client, winner!.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, next.StatusCode);
    }

    [Theory]
    [InlineData("/api/auth/login")]
    [InlineData("/api/auth/refresh")]
    [InlineData("/api/auth/logout")]
    public async Task Null_json_body_returns_400_problem(string path)
    {
        using var client = factory.CreateClientWithOwnIp();
        using var content = new StringContent("null", Encoding.UTF8, "application/json");

        var response = await client.PostAsync(new Uri(path, UriKind.Relative), content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
