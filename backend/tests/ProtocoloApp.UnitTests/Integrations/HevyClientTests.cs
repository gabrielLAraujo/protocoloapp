using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Features.Integrations.Hevy;

namespace ProtocoloApp.UnitTests.Integrations;

public sealed class HevyClientTests
{
    private const string Key = "test-key-0000-0000-0000-000000000001";

    private sealed class FakeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return respond(request, cancellationToken);
        }
    }

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public List<string> Messages { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            Messages.Add(formatter(state, exception));
            if (exception is not null)
                Messages.Add(exception.ToString());
        }
    }

    private static string Fixture(string name) => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "hevy", name));

    private static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static (HevyClient Client, FakeHandler Handler, CapturingLogger<HevyClient> Logger) Create(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond)
    {
        var handler = new FakeHandler(respond);
        var http = new HttpClient(handler) { BaseAddress = new Uri("https://api.hevyapp.com/") };
        var logger = new CapturingLogger<HevyClient>();
        return (new HevyClient(http, logger), handler, logger);
    }

    private static (HevyClient Client, FakeHandler Handler, CapturingLogger<HevyClient> Logger) Create(Func<HttpResponseMessage> respond) =>
        Create((_, _) => Task.FromResult(respond()));

    [Fact]
    public async Task Events_send_the_api_key_header_and_page_size_and_since_in_utc()
    {
        var (client, handler, _) = Create(() => Json(Fixture("events-page.json")));
        var since = new DateTimeOffset(2026, 10, 20, 9, 30, 15, TimeSpan.FromHours(-3));

        var result = await client.GetEventsAsync(Key, since, 2, CancellationToken.None);

        Assert.Null(result.Error);
        Assert.Equal(2, result.Value!.Items.Count);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("https://api.hevyapp.com/v1/workouts/events?page=2&pageSize=10&since=2026-10-20T12:30:15Z", request.RequestUri!.ToString());
        Assert.Equal([Key], request.Headers.GetValues("api-key"));
    }

    [Fact]
    public async Task Workouts_use_page_size_10()
    {
        var (client, handler, _) = Create(() => Json(Fixture("workouts-page.json")));

        var result = await client.GetWorkoutsAsync(Key, 3, CancellationToken.None);

        Assert.Equal(2, result.Value!.Items.Count);
        Assert.Equal("https://api.hevyapp.com/v1/workouts?page=3&pageSize=10", Assert.Single(handler.Requests).RequestUri!.ToString());
    }

    [Fact]
    public async Task Templates_use_page_size_100()
    {
        var (client, handler, _) = Create(() => Json(Fixture("exercise-templates-page.json")));

        var result = await client.GetTemplatesAsync(Key, 1, CancellationToken.None);

        Assert.Equal(2, result.Value!.Items.Count);
        Assert.Equal("https://api.hevyapp.com/v1/exercise_templates?page=1&pageSize=100", Assert.Single(handler.Requests).RequestUri!.ToString());
    }

    [Fact]
    public async Task Single_workout_escapes_the_id()
    {
        var (client, handler, _) = Create(() => Json("""{"id":"a/b","title":"Treino Exemplo","start_time":"2026-10-01T10:00:00Z"}"""));

        var result = await client.GetWorkoutAsync(Key, "a/b", CancellationToken.None);

        Assert.Equal("a/b", result.Value!.Id);
        Assert.Equal("https://api.hevyapp.com/v1/workouts/a%2Fb", Assert.Single(handler.Requests).RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task Check_key_calls_user_info_and_accepts_a_json_object()
    {
        var (client, handler, _) = Create(() => Json("""{"data":{"id":"u1","name":"Usuario Exemplo","url":"https://hevy.com/user/exemplo"}}"""));

        Assert.Null(await client.CheckKeyAsync(Key, CancellationToken.None));
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://api.hevyapp.com/v1/user/info", request.RequestUri!.ToString());
        Assert.Equal([Key], request.Headers.GetValues("api-key"));
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, HevyError.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden, HevyError.Unauthorized)]
    [InlineData(HttpStatusCode.TooManyRequests, HevyError.RateLimited)]
    [InlineData(HttpStatusCode.ServiceUnavailable, HevyError.Unavailable)]
    [InlineData(HttpStatusCode.InternalServerError, HevyError.Unavailable)]
    [InlineData(HttpStatusCode.RequestTimeout, HevyError.Unavailable)]
    [InlineData(HttpStatusCode.NotFound, HevyError.Format)]
    [InlineData(HttpStatusCode.Found, HevyError.Format)]
    public async Task Status_codes_map_to_errors(HttpStatusCode status, HevyError expected)
    {
        var (client, _, _) = Create(() => Json("{}", status));

        Assert.Equal(expected, (await client.GetWorkoutsAsync(Key, 1, CancellationToken.None)).Error);
        Assert.Equal(expected, (await client.GetEventsAsync(Key, DateTimeOffset.UnixEpoch, 1, CancellationToken.None)).Error);
        Assert.Equal(expected, (await client.GetWorkoutAsync(Key, "w1", CancellationToken.None)).Error);
        Assert.Equal(expected, (await client.GetTemplatesAsync(Key, 1, CancellationToken.None)).Error);
        Assert.Equal(expected, await client.CheckKeyAsync(Key, CancellationToken.None));
    }

    [Fact]
    public async Task A_timeout_is_unavailable()
    {
        var (client, _, _) = Create((_, _) => throw new TaskCanceledException("timeout", new TimeoutException()));

        Assert.Equal(HevyError.Unavailable, (await client.GetWorkoutsAsync(Key, 1, CancellationToken.None)).Error);
        Assert.Equal(HevyError.Unavailable, await client.CheckKeyAsync(Key, CancellationToken.None));
    }

    [Fact]
    public async Task A_network_error_is_unavailable()
    {
        var (client, _, _) = Create((_, _) => throw new HttpRequestException("boom"));

        Assert.Equal(HevyError.Unavailable, (await client.GetEventsAsync(Key, DateTimeOffset.UnixEpoch, 1, CancellationToken.None)).Error);
    }

    [Fact]
    public async Task Caller_cancellation_is_not_swallowed()
    {
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();
        var (client, _, _) = Create((_, ct) => Task.FromCanceled<HttpResponseMessage>(ct));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.GetWorkoutsAsync(Key, 1, cts.Token));
    }

    [Fact]
    public async Task Html_is_a_format_error()
    {
        var (client, _, _) = Create(() => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<html><body>login</body></html>", Encoding.UTF8, "text/html"),
        });

        Assert.Equal(HevyError.Format, (await client.GetWorkoutsAsync(Key, 1, CancellationToken.None)).Error);
        Assert.Equal(HevyError.Format, await client.CheckKeyAsync(Key, CancellationToken.None));
    }

    [Fact]
    public async Task An_unexpected_envelope_is_a_format_error()
    {
        var (client, _, _) = Create(() => Json(Fixture("unexpected-envelope.json")));

        Assert.Equal(HevyError.Format, (await client.GetWorkoutsAsync(Key, 1, CancellationToken.None)).Error);
        Assert.Equal(HevyError.Format, (await client.GetEventsAsync(Key, DateTimeOffset.UnixEpoch, 1, CancellationToken.None)).Error);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("key with spaces")]
    [InlineData("key\r\nX-Injected: 1")]
    [InlineData("chave-ç")]
    public async Task A_key_that_cannot_be_a_header_is_unauthorized_without_a_request(string key)
    {
        var (client, handler, logger) = Create(() => Json("{}"));

        Assert.Equal(HevyError.Unauthorized, await client.CheckKeyAsync(key, CancellationToken.None));
        Assert.Equal(HevyError.Unauthorized, (await client.GetWorkoutsAsync(key, 1, CancellationToken.None)).Error);
        Assert.Empty(handler.Requests);
        if (key.Trim().Length > 0)
            Assert.DoesNotContain(logger.Messages, m => m.Contains(key, StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_key_longer_than_200_is_unauthorized_without_a_request()
    {
        var (client, handler, _) = Create(() => Json("{}"));

        Assert.Equal(HevyError.Unauthorized, await client.CheckKeyAsync(new string('a', 201), CancellationToken.None));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Logs_never_contain_the_key_or_payload_content()
    {
        var responses = new Queue<Func<HttpResponseMessage>>(
        [
            () => Json("{}", HttpStatusCode.Unauthorized),
            () => Json("{}", HttpStatusCode.TooManyRequests),
            () => throw new HttpRequestException($"failure for {Key}"),
            () => Json("not json " + Key),
            () => Json(Fixture("workouts-page.json")),
            () => Json(Fixture("workout-odd-fields.json")),
        ]);
        var (client, _, logger) = Create(() => responses.Dequeue()());

        for (var i = 0; i < 6; i++)
            await client.GetWorkoutsAsync(Key, 1, CancellationToken.None);

        Assert.NotEmpty(logger.Messages);
        Assert.DoesNotContain(logger.Messages, m => m.Contains(Key, StringComparison.Ordinal));
        Assert.DoesNotContain(logger.Messages, m => m.Contains("Treino", StringComparison.Ordinal));
        Assert.DoesNotContain(logger.Messages, m => m.Contains("Exemplo", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("https://api.hevyapp.com/", true)]
    [InlineData("https://api.hevyapp.com", true)]
    [InlineData("http://127.0.0.1:5099/", true)]
    [InlineData("http://localhost:5099", true)]
    [InlineData("http://[::1]:5099/", true)]
    [InlineData("http://api.hevyapp.com/", false)]
    [InlineData("ftp://api.hevyapp.com/", false)]
    [InlineData("not a url", false)]
    [InlineData("", false)]
    public void Base_url_is_https_or_loopback_http(string url, bool valid)
    {
        Assert.Equal(valid, HevyOptions.TryGetBaseAddress(url, out var uri));
        if (valid)
            Assert.EndsWith("/", uri!.AbsoluteUri, StringComparison.Ordinal);
    }

    private static ServiceProvider BuildServices(Dictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddHevyClient(configuration);
        return services.BuildServiceProvider();
    }

    [Fact]
    public void Registration_configures_base_address_timeout_and_response_limit()
    {
        using var provider = BuildServices(new() { ["Hevy:BaseUrl"] = "http://127.0.0.1:5099" });

        Assert.IsType<HevyClient>(provider.GetRequiredService<IHevyClient>());
        var http = provider.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(IHevyClient));
        Assert.Equal(new Uri("http://127.0.0.1:5099/"), http.BaseAddress);
        Assert.Equal(TimeSpan.FromSeconds(20), http.Timeout);
        Assert.Equal(HevyClient.MaxResponseBytes, http.MaxResponseContentBufferSize);
    }

    [Fact]
    public void Registration_defaults_to_the_public_api()
    {
        using var provider = BuildServices(new());

        var options = provider.GetRequiredService<IOptions<HevyOptions>>().Value;
        Assert.True(options.Enabled);
        Assert.Equal(30, options.IntervalMinutes);
        var http = provider.GetRequiredService<IHttpClientFactory>().CreateClient(nameof(IHevyClient));
        Assert.Equal(new Uri("https://api.hevyapp.com/"), http.BaseAddress);
    }

    [Fact]
    public void Registration_rejects_an_insecure_base_url()
    {
        using var provider = BuildServices(new() { ["Hevy:BaseUrl"] = "http://api.hevyapp.com/" });

        Assert.Throws<OptionsValidationException>(() => provider.GetRequiredService<IOptions<HevyOptions>>().Value);
    }
}
