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

        var next = await AuthApi.RefreshAsync(client, second.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, next.StatusCode);
    }

    [Fact]
    public async Task Retry_within_grace_after_a_lost_response_succeeds_and_revokes_the_unused_successor()
    {
        var (client, first) = await LoginNewUserAsync();
        using var _ = client;
        // The server rotated, but the answer never reached the phone.
        var lost = await ReadTokensAsync(await AuthApi.RefreshAsync(client, first.RefreshToken));

        var retry = await AuthApi.RefreshAsync(client, first.RefreshToken);

        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        var retried = await ReadTokensAsync(retry);
        Assert.NotEqual(lost.RefreshToken, retried.RefreshToken);
        Assert.Equal(1, await LiveTokensInFamilyAsync(retried.RefreshToken));
        Assert.NotNull(await RevokedAtAsync(lost.RefreshToken));

        var next = await AuthApi.RefreshAsync(client, retried.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, next.StatusCode);
    }

    [Fact]
    public async Task Reuse_after_the_grace_revokes_family()
    {
        var (client, first) = await LoginNewUserAsync();
        using var _ = client;
        var second = await ReadTokensAsync(await AuthApi.RefreshAsync(client, first.RefreshToken));
        await MoveSpendBackAsync(first.RefreshToken, TokenService.ReuseGrace + TimeSpan.FromSeconds(1));

        // The old token comes back after the grace (leaked): 401 and the whole family dies.
        var reuse = await AuthApi.RefreshAsync(client, first.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);

        var newest = await AuthApi.RefreshAsync(client, second.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, newest.StatusCode);
    }

    [Fact]
    public async Task Reuse_after_the_successor_was_used_revokes_family()
    {
        var (client, first) = await LoginNewUserAsync();
        using var _ = client;
        var second = await ReadTokensAsync(await AuthApi.RefreshAsync(client, first.RefreshToken));
        var third = await ReadTokensAsync(await AuthApi.RefreshAsync(client, second.RefreshToken));

        // Within the grace, but the successor was used: someone else holds the chain. 401 and the family dies.
        var reuse = await AuthApi.RefreshAsync(client, first.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);

        var newest = await AuthApi.RefreshAsync(client, third.RefreshToken);
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
    public async Task Concurrent_refreshes_with_same_token_leave_exactly_one_live_token()
    {
        var (client, first) = await LoginNewUserAsync();
        using var _ = client;

        var responses = await Task.WhenAll(
            AuthApi.RefreshAsync(client, first.RefreshToken),
            AuthApi.RefreshAsync(client, first.RefreshToken));

        // Serialized by the family lock, the second is a retry within the grace: both succeed, and the second revokes
        // the first one's successor. Exactly one refresh token stays alive, and it is one of the two returned.
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        var returned = await Task.WhenAll(responses.Select(ReadTokensAsync));
        Assert.NotEqual(returned[0].RefreshToken, returned[1].RefreshToken);
        Assert.Equal(1, await LiveTokensInFamilyAsync(returned[0].RefreshToken));

        var states = await Task.WhenAll(returned.Select(t => RevokedAtAsync(t.RefreshToken)));
        Assert.Single(states, revokedAt => revokedAt is null);
        var live = returned[Array.FindIndex(states, revokedAt => revokedAt is null)];

        var next = await AuthApi.RefreshAsync(client, live.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, next.StatusCode);
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

    private static async Task<TokenResponse> ReadTokensAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<TokenResponse>())!;
    }

    private static string Hash(string raw) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));

    private async Task<DateTimeOffset?> RevokedAtAsync(string rawToken)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var hash = Hash(rawToken);
        return await db.RefreshTokens.Where(t => t.TokenHash == hash).Select(t => t.RevokedAt).SingleAsync();
    }

    /// <summary>Unrevoked tokens in the family of <paramref name="rawToken"/>.</summary>
    private async Task<int> LiveTokensInFamilyAsync(string rawToken)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var hash = Hash(rawToken);
        var familyId = await db.RefreshTokens.Where(t => t.TokenHash == hash).Select(t => t.FamilyId).SingleAsync();
        return await db.RefreshTokens.CountAsync(t => t.FamilyId == familyId && t.RevokedAt == null);
    }

    /// <summary>Makes the spend of <paramref name="rawToken"/> look <paramref name="ago"/> old (instead of waiting).</summary>
    private async Task MoveSpendBackAsync(string rawToken, TimeSpan ago)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var hash = Hash(rawToken);
        var spentAt = DateTimeOffset.UtcNow - ago;
        var updated = await db.RefreshTokens.Where(t => t.TokenHash == hash)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, spentAt));
        Assert.Equal(1, updated);
    }
}
