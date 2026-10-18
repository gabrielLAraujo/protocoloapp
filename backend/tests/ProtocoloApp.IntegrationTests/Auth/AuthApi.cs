using System.Net.Http.Json;
using ProtocoloApp.Api.Features.Auth;

namespace ProtocoloApp.IntegrationTests.Auth;

/// <summary>Thin wrappers over the auth endpoints so the tests read as scenarios.</summary>
internal static class AuthApi
{
    public static Task<HttpResponseMessage> LoginAsync(HttpClient client, string email, string password) =>
        client.PostAsJsonAsync(new Uri("/api/auth/login", UriKind.Relative), new LoginRequest(email, password));

    public static Task<HttpResponseMessage> RefreshAsync(HttpClient client, string refreshToken) =>
        client.PostAsJsonAsync(new Uri("/api/auth/refresh", UriKind.Relative), new RefreshRequest(refreshToken));

    public static Task<HttpResponseMessage> LogoutAsync(HttpClient client, string refreshToken) =>
        client.PostAsJsonAsync(new Uri("/api/auth/logout", UriKind.Relative), new RefreshRequest(refreshToken));

    public static async Task<TokenResponse> LoginOkAsync(HttpClient client, string email, string password)
    {
        var response = await LoginAsync(client, email, password);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TokenResponse>())!;
    }

    public static string NewEmail() => $"{Guid.NewGuid():N}@example.com";
}
