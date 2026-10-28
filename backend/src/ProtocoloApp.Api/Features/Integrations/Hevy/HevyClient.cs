using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>
/// Talks only to the configured base address (redirects are not followed). The key goes in the <c>api-key</c> header,
/// which the HTTP logging redacts; this class logs only status codes, counts and exception type names.
/// </summary>
public sealed class HevyClient(HttpClient http, ILogger<HevyClient> logger) : IHevyClient
{
    public const string ApiKeyHeader = "api-key";

    /// <summary>The API's maximum for workouts and events.</summary>
    public const int WorkoutPageSize = 10;

    public const int TemplatePageSize = 100;

    /// <summary>Ceiling of pages read in one sync run.</summary>
    public const int MaxPagesPerRun = 50;

    /// <summary>Pause between pages in a sync run.</summary>
    public static readonly TimeSpan PageDelay = TimeSpan.FromMilliseconds(300);

    public const int MaxKeyLength = 200;

    public const long MaxResponseBytes = 2 * 1024 * 1024;

    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);

    public async Task<HevyError?> CheckKeyAsync(string apiKey, CancellationToken ct)
    {
        // Any JSON object is an accepted key: only the status matters, the profile is not read.
        var result = await GetAsync<string>(apiKey, "v1/user/info", "user info",
            root => root.ValueKind == JsonValueKind.Object ? "ok" : null, ct);
        return result.Error;
    }

    public Task<HevyResult<HevyPage<HevyWorkout>>> GetWorkoutsAsync(string apiKey, int page, CancellationToken ct) =>
        GetPageAsync(apiKey, $"v1/workouts?page={Number(page)}&pageSize={Number(WorkoutPageSize)}", "workouts", HevyParser.Workouts, ct);

    public Task<HevyResult<HevyPage<HevyEvent>>> GetEventsAsync(string apiKey, DateTimeOffset since, int page, CancellationToken ct)
    {
        var sinceUtc = since.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture);
        return GetPageAsync(apiKey, $"v1/workouts/events?page={Number(page)}&pageSize={Number(WorkoutPageSize)}&since={sinceUtc}",
            "events", HevyParser.Events, ct);
    }

    public Task<HevyResult<HevyWorkout>> GetWorkoutAsync(string apiKey, string id, CancellationToken ct) =>
        GetAsync(apiKey, "v1/workouts/" + Uri.EscapeDataString(id), "workout", HevyParser.Workout, ct);

    public Task<HevyResult<HevyPage<HevyTemplate>>> GetTemplatesAsync(string apiKey, int page, CancellationToken ct) =>
        GetPageAsync(apiKey, $"v1/exercise_templates?page={Number(page)}&pageSize={Number(TemplatePageSize)}", "templates",
            HevyParser.Templates, ct);

    /// <summary>A key that could not travel as a header value (empty, too long, spaces, control or non-ASCII characters).</summary>
    internal static bool IsSendableKey(string? apiKey) =>
        !string.IsNullOrEmpty(apiKey) && apiKey.Length <= MaxKeyLength && apiKey.All(c => c is > ' ' and < '\u007f');

    private static string Number(int value) => value.ToString(CultureInfo.InvariantCulture);

    private async Task<HevyResult<HevyPage<T>>> GetPageAsync<T>(
        string apiKey, string path, string what, Func<JsonElement, HevyPage<T>?> parse, CancellationToken ct)
    {
        var result = await GetAsync(apiKey, path, what, parse, ct);
        if (result.Value is { Skipped: > 0 } page)
            logger.LogWarning("Hevy {What} page: {Skipped} entries skipped, {Kept} kept.", what, page.Skipped, page.Items.Count);
        return result;
    }

    private async Task<HevyResult<T>> GetAsync<T>(
        string apiKey, string path, string what, Func<JsonElement, T?> parse, CancellationToken ct)
    {
        if (!IsSendableKey(apiKey))
        {
            logger.LogWarning("Hevy {What} request not sent: the key cannot be a header value.", what);
            return HevyResult<T>.Fail(HevyError.Unauthorized);
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(path, UriKind.Relative));
            request.Headers.TryAddWithoutValidation(ApiKeyHeader, apiKey);
            request.Headers.Accept.ParseAdd("application/json");

            using var response = await http.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                var error = FromStatus(response.StatusCode);
                logger.LogWarning("Hevy {What} request failed: status {Status} ({Error}).", what, (int)response.StatusCode, error);
                return HevyResult<T>.Fail(error);
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var value = parse(document.RootElement);
            if (value is null)
            {
                logger.LogWarning("Hevy {What} response had an unexpected format.", what);
                return HevyResult<T>.Fail(HevyError.Format);
            }

            return HevyResult<T>.Ok(value);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (JsonException ex)
        {
            logger.LogWarning("Hevy {What} response was not JSON: {Error}.", what, ex.GetType().Name);
            return HevyResult<T>.Fail(HevyError.Format);
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or IOException)
        {
            // Timeout (HttpClient.Timeout surfaces as a cancellation the caller did not ask for), network, body too large.
            logger.LogWarning("Hevy {What} request failed: {Error}.", what, ex.GetType().Name);
            return HevyResult<T>.Fail(HevyError.Unavailable);
        }
    }

    private static HevyError FromStatus(HttpStatusCode status) => status switch
    {
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => HevyError.Unauthorized,
        HttpStatusCode.TooManyRequests => HevyError.RateLimited,
        HttpStatusCode.RequestTimeout => HevyError.Unavailable,
        >= HttpStatusCode.InternalServerError => HevyError.Unavailable,
        _ => HevyError.Format,
    };
}

internal static class HevyClientSetup
{
    /// <summary>
    /// The typed <see cref="IHevyClient"/>: base address from <c>Hevy:BaseUrl</c> (validated at start), 20 s timeout,
    /// 2 MB response cap, no redirects, <c>api-key</c> redacted from the HTTP logs. Called by <c>HevySetup.AddHevy</c>.
    /// </summary>
    internal static IServiceCollection AddHevyClient(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddOptions<HevyOptions>()
            .Bind(configuration.GetSection(HevyOptions.Section))
            .Validate(o => HevyOptions.TryGetBaseAddress(o.BaseUrl, out _), "Hevy:BaseUrl must be https (http only for a loopback host).")
            .Validate(o => o.IntervalMinutes > 0, "Hevy:IntervalMinutes must be positive.")
            .ValidateOnStart();

        services.AddHttpClient<IHevyClient, HevyClient>((sp, client) =>
            {
                var options = sp.GetRequiredService<IOptions<HevyOptions>>().Value;
                HevyOptions.TryGetBaseAddress(options.BaseUrl, out var baseAddress);
                client.BaseAddress = baseAddress;
                client.Timeout = HevyClient.Timeout;
                client.MaxResponseContentBufferSize = HevyClient.MaxResponseBytes;
            })
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false })
            .RedactLoggedHeaders([HevyClient.ApiKeyHeader]);
        return services;
    }
}
