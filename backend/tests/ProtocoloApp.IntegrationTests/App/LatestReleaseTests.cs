using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.App;

/// <summary>The update check: the API asks GitHub (a fake here) for the latest release and proxies the APK to the logged-in app.</summary>
[Collection("api")]
public sealed class LatestReleaseTests(ApiFactory factory)
{
    private const string LatestPath = "/repos/gabrielLAraujo/protocoloapp/releases/latest";
    private const string AssetPath = "/repos/gabrielLAraujo/protocoloapp/releases/assets/42";
    private const string ReleaseJson = """
        {"tag_name":"v0.1.12","draft":false,"prerelease":false,"assets":[{"id":41,"name":"notes.txt"},{"id":42,"name":"protocolo-0.1.12.apk"}]}
        """;

    private static readonly byte[] ApkBytes = [0x50, 0x4B, 0x03, 0x04, 1, 2, 3, 4, 5];

    [Fact]
    public async Task Maps_the_latest_release_to_version_and_apk_url()
    {
        var github = new FakeGitHubHandler(request => request.Uri.AbsolutePath == LatestPath
            ? FakeGitHubHandler.Json(ReleaseJson)
            : new HttpResponseMessage(HttpStatusCode.NotFound));
        using var app = AppWith(github, token: "test-token");
        using var client = await LoggedInClientAsync(app);

        var response = await client.GetAsync(new Uri("/api/app/latest-release", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("0.1.12", body.RootElement.GetProperty("version").GetString());
        Assert.EndsWith("/api/app/apk", body.RootElement.GetProperty("apkUrl").GetString(), StringComparison.Ordinal);

        var sent = Assert.Single(github.Requests);
        Assert.Equal("Bearer test-token", sent.Authorization);
    }

    [Fact]
    public async Task Caches_the_release_for_a_while()
    {
        var github = new FakeGitHubHandler(_ => FakeGitHubHandler.Json(ReleaseJson));
        using var app = AppWith(github, token: "test-token");
        using var client = await LoggedInClientAsync(app);

        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(new Uri("/api/app/latest-release", UriKind.Relative))).StatusCode);

        Assert.Single(github.Requests);
    }

    [Fact]
    public async Task Concurrent_requests_on_a_cold_cache_make_one_github_call()
    {
        var github = new FakeGitHubHandler(_ => FakeGitHubHandler.Json(ReleaseJson)) { Delay = TimeSpan.FromMilliseconds(300) };
        using var app = AppWith(github, token: "test-token");
        using var client = await LoggedInClientAsync(app);

        var responses = await Task.WhenAll(Enumerable.Range(0, 5)
            .Select(_ => client.GetAsync(new Uri("/api/app/latest-release", UriKind.Relative))));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Single(github.Requests);
    }

    [Fact]
    public async Task A_github_failure_is_remembered_for_a_minute()
    {
        var github = new FakeGitHubHandler(_ => FakeGitHubHandler.Json("{}", HttpStatusCode.BadGateway));
        using var app = AppWith(github, token: "test-token");
        using var client = await LoggedInClientAsync(app);

        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync(new Uri("/api/app/latest-release", UriKind.Relative))).StatusCode);

        Assert.Single(github.Requests);
    }

    [Fact]
    public async Task No_release_yet_is_remembered_for_a_minute()
    {
        var github = new FakeGitHubHandler(_ => FakeGitHubHandler.Json("{}", HttpStatusCode.NotFound));
        using var app = AppWith(github, token: "test-token");
        using var client = await LoggedInClientAsync(app);

        for (var i = 0; i < 3; i++)
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(new Uri("/api/app/latest-release", UriKind.Relative))).StatusCode);

        Assert.Single(github.Requests);
    }

    [Fact]
    public async Task Returns_503_problem_when_github_is_down()
    {
        var github = new FakeGitHubHandler(_ => FakeGitHubHandler.Json("{}", HttpStatusCode.BadGateway));
        using var app = AppWith(github, token: "test-token");
        using var client = await LoggedInClientAsync(app);

        var response = await client.GetAsync(new Uri("/api/app/latest-release", UriKind.Relative));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Returns_503_problem_when_the_token_is_not_configured_and_does_not_call_github()
    {
        var github = new FakeGitHubHandler(_ => FakeGitHubHandler.Json(ReleaseJson));
        using var app = AppWith(github, token: null);
        using var client = await LoggedInClientAsync(app);

        var response = await client.GetAsync(new Uri("/api/app/latest-release", UriKind.Relative));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Empty(github.Requests);
    }

    [Fact]
    public async Task Returns_404_problem_when_there_is_no_release_yet()
    {
        var github = new FakeGitHubHandler(_ => FakeGitHubHandler.Json("""{"message":"Not Found"}""", HttpStatusCode.NotFound));
        using var app = AppWith(github, token: "test-token");
        using var client = await LoggedInClientAsync(app);

        var response = await client.GetAsync(new Uri("/api/app/latest-release", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Both_endpoints_require_login()
    {
        var github = new FakeGitHubHandler(_ => FakeGitHubHandler.Json(ReleaseJson));
        using var app = AppWith(github, token: "test-token");
        using var client = app.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(new Uri("/api/app/latest-release", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(new Uri("/api/app/apk", UriKind.Relative))).StatusCode);
        Assert.Empty(github.Requests);
    }

    [Fact]
    public async Task Apk_is_streamed_from_the_asset_api_and_follows_the_redirect_without_the_token()
    {
        var github = new FakeGitHubHandler(request => request.Uri.Host switch
        {
            "objects.example.test" => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(ApkBytes) },
            _ when request.Uri.AbsolutePath == LatestPath => FakeGitHubHandler.Json(ReleaseJson),
            _ when request.Uri.AbsolutePath == AssetPath => RedirectTo("https://objects.example.test/signed/protocolo.apk?sig=abc"),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound),
        });
        using var app = AppWith(github, token: "test-token");
        using var client = await LoggedInClientAsync(app);

        var response = await client.GetAsync(new Uri("/api/app/apk", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/vnd.android.package-archive", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(ApkBytes, await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(ApkBytes.Length, response.Content.Headers.ContentLength);
        Assert.Equal("attachment", response.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal("protocolo-0.1.12.apk", response.Content.Headers.ContentDisposition?.FileName);

        var asset = Assert.Single(github.Requests, r => r.Uri.AbsolutePath == AssetPath);
        Assert.Equal("Bearer test-token", asset.Authorization);
        Assert.Equal("application/octet-stream", asset.Accept);
        var signed = Assert.Single(github.Requests, r => r.Uri.Host == "objects.example.test");
        Assert.Null(signed.Authorization);
    }

    [Fact]
    public async Task Apk_returns_503_problem_when_github_is_down()
    {
        var github = new FakeGitHubHandler(request => request.Uri.AbsolutePath == LatestPath
            ? FakeGitHubHandler.Json(ReleaseJson)
            : FakeGitHubHandler.Json("{}", HttpStatusCode.BadGateway));
        using var app = AppWith(github, token: "test-token");
        using var client = await LoggedInClientAsync(app);

        var response = await client.GetAsync(new Uri("/api/app/apk", UriKind.Relative));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    private static HttpResponseMessage RedirectTo(string location)
    {
        var response = new HttpResponseMessage(HttpStatusCode.Found);
        response.Headers.Location = new Uri(location);
        return response;
    }

    /// <summary>The API with GitHub replaced by <paramref name="github"/> (every outgoing HttpClient goes through it).</summary>
    private WebApplicationFactory<Program> AppWith(FakeGitHubHandler github, string? token) =>
        factory.WithWebHostBuilder(builder =>
        {
            if (token is not null)
                builder.UseSetting("GitHub:Token", token);
            builder.ConfigureTestServices(services => services.ConfigureAll<HttpClientFactoryOptions>(options =>
                options.HttpMessageHandlerBuilderActions.Add(handler => handler.PrimaryHandler = github)));
        });

    /// <summary>A client of <paramref name="app"/> carrying a valid access token (the signing key is the same in every host of the factory).</summary>
    private async Task<HttpClient> LoggedInClientAsync(WebApplicationFactory<Program> app)
    {
        using var login = await factory.CreateAuthenticatedClientAsync();
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", login.DefaultRequestHeaders.Authorization!.Parameter);
        return client;
    }
}
