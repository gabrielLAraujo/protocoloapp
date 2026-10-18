using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Auth;

[Collection("api")]
public sealed class LoginTests(ApiFactory factory)
{
    [Fact]
    public async Task Valid_credentials_return_tokens()
    {
        var email = AuthApi.NewEmail();
        await factory.CreateUserAsync(email);
        using var client = factory.CreateClientWithOwnIp();

        var before = DateTimeOffset.UtcNow;
        var response = await AuthApi.LoginAsync(client, email, ApiFactory.DefaultPassword);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var tokens = await response.Content.ReadFromJsonAsync<TokenResponse>();
        Assert.NotNull(tokens);
        Assert.False(string.IsNullOrWhiteSpace(tokens.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(tokens.RefreshToken));
        var expected = before.AddMinutes(15);
        Assert.InRange(tokens.AccessTokenExpiresAt, expected.AddMinutes(-1), expected.AddMinutes(1));
    }

    [Fact]
    public async Task Wrong_password_returns_401_problem()
    {
        var email = AuthApi.NewEmail();
        await factory.CreateUserAsync(email);
        using var client = factory.CreateClientWithOwnIp();

        var wrongPassword = await AuthApi.LoginAsync(client, email, "outra-senha-qualquer");
        var unknownEmail = await AuthApi.LoginAsync(client, AuthApi.NewEmail(), "outra-senha-qualquer");

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal("application/problem+json", wrongPassword.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmail.StatusCode);
        Assert.Equal("application/problem+json", unknownEmail.Content.Headers.ContentType?.MediaType);

        // The same message in both cases: the response must not reveal whether the e-mail exists.
        var first = await wrongPassword.Content.ReadFromJsonAsync<JsonElement>();
        var second = await unknownEmail.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(first.GetProperty("detail").GetString(), second.GetProperty("detail").GetString());
        Assert.Equal(first.GetProperty("title").GetString(), second.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Me_requires_bearer()
    {
        var email = AuthApi.NewEmail();
        await factory.CreateUserAsync(email);
        using var anonymous = factory.CreateClientWithOwnIp();

        var denied = await anonymous.GetAsync(new Uri("/api/auth/me", UriKind.Relative));
        Assert.Equal(HttpStatusCode.Unauthorized, denied.StatusCode);

        var tokens = await AuthApi.LoginOkAsync(anonymous, email, ApiFactory.DefaultPassword);
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri("/api/auth/me", UriKind.Relative));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.AccessToken);
        var allowed = await anonymous.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        var me = await allowed.Content.ReadFromJsonAsync<MeResponse>();
        Assert.NotNull(me);
        Assert.Equal(email, me.Email, ignoreCase: true);
        Assert.NotEqual(Guid.Empty, me.Id);
    }

    [Fact]
    public async Task Authenticated_client_reaches_me()
    {
        using var client = await factory.CreateAuthenticatedClientAsync();

        var response = await client.GetAsync(new Uri("/api/auth/me", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var me = await response.Content.ReadFromJsonAsync<MeResponse>();
        Assert.Equal("teste@example.com", me!.Email, ignoreCase: true);
    }

    [Fact]
    public async Task Login_is_rate_limited()
    {
        using var client = factory.CreateClientWithOwnIp();

        // Unknown e-mails, so the account lockout (5 failures per user) is out of the picture: only the IP limiter acts.
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var response = await AuthApi.LoginAsync(client, AuthApi.NewEmail(), "outra-senha-qualquer");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        var sixth = await AuthApi.LoginAsync(client, AuthApi.NewEmail(), "outra-senha-qualquer");

        Assert.Equal(HttpStatusCode.TooManyRequests, sixth.StatusCode);
    }
}
