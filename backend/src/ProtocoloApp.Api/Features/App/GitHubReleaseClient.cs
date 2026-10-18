using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace ProtocoloApp.Api.Features.App;

/// <summary>The latest release of the app: its version (tag without the leading <c>v</c>) and the id of its APK asset.</summary>
public sealed record ReleaseInfo(string Version, long ApkAssetId);

/// <summary>Typed HttpClient for the GitHub REST API (the repository is private, every call carries the token).</summary>
public sealed class GitHubReleaseClient(HttpClient http, IOptions<GitHubOptions> options, ILogger<GitHubReleaseClient> logger)
{
    private const int MaxRedirects = 3;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    /// <returns>The latest release, or <c>null</c> when there is none yet or it carries no APK.</returns>
    /// <exception cref="GitHubUnavailableException">Not configured, GitHub is down or answered something unreadable.</exception>
    public async Task<ReleaseInfo?> GetLatestAsync(CancellationToken ct)
    {
        var settings = RequireSettings();
        using var request = Authorized(HttpMethod.Get, $"repos/{settings.Repository}/releases/latest", settings, "application/vnd.github+json");

        try
        {
            using var response = await http.SendAsync(request, ct);
            if (response.StatusCode == HttpStatusCode.NotFound)
                return null;
            if (!response.IsSuccessStatusCode)
                throw Failed($"GitHub answered {(int)response.StatusCode} for the latest release.");

            var release = await response.Content.ReadFromJsonAsync<GitHubRelease>(JsonOptions, ct)
                ?? throw Failed("GitHub answered an empty release.");
            var apk = release.Assets?.FirstOrDefault(a => a.Name?.EndsWith(".apk", StringComparison.OrdinalIgnoreCase) == true);
            var version = release.TagName?.Trim().TrimStart('v', 'V');
            return apk is null || string.IsNullOrEmpty(version) ? null : new ReleaseInfo(version, apk.Id);
        }
        catch (Exception ex) when (IsTransport(ex, ct))
        {
            throw Failed("GitHub could not be reached or answered something unreadable.", ex);
        }
    }

    /// <summary>
    /// Opens the APK asset as a stream. The asset API answers with a redirect to a signed storage URL, which is followed by hand
    /// so the token is never sent to the other host. The caller disposes the response.
    /// </summary>
    /// <exception cref="GitHubUnavailableException">Not configured, GitHub is down or the asset is gone.</exception>
    public async Task<HttpResponseMessage> OpenAssetAsync(long assetId, CancellationToken ct)
    {
        var settings = RequireSettings();
        var request = Authorized(HttpMethod.Get, $"repos/{settings.Repository}/releases/assets/{assetId}", settings, "application/octet-stream");
        HttpResponseMessage? response = null;
        try
        {
            for (var hop = 0; ; hop++)
            {
                response?.Dispose();
                response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);

                var location = response.Headers.Location;
                if (!IsRedirect(response.StatusCode) || location is null)
                    break;
                if (hop >= MaxRedirects)
                    throw Failed("GitHub redirected the APK download too many times.");

                var next = location.IsAbsoluteUri ? location : new Uri(request.RequestUri!, location);
                request.Dispose();
                // The signed URL carries its own authorization: no token, no Accept.
                request = new HttpRequestMessage(HttpMethod.Get, next);
            }

            if (!response.IsSuccessStatusCode)
                throw Failed($"GitHub answered {(int)response.StatusCode} for the APK asset.");
            return response;
        }
        catch (GitHubUnavailableException)
        {
            response?.Dispose();
            throw;
        }
        catch (Exception ex) when (IsTransport(ex, ct))
        {
            response?.Dispose();
            throw Failed("GitHub could not be reached while downloading the APK.", ex);
        }
        finally
        {
            request.Dispose();
        }
    }

    // A timeout surfaces as TaskCanceledException; the caller giving up (its own token) must stay a cancellation.
    private static bool IsTransport(Exception ex, CancellationToken ct) =>
        ex is HttpRequestException or JsonException or NotSupportedException || (ex is TaskCanceledException && !ct.IsCancellationRequested);

    private static bool IsRedirect(HttpStatusCode status) =>
        status is HttpStatusCode.MovedPermanently or HttpStatusCode.Found or HttpStatusCode.SeeOther
            or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect;

    private static HttpRequestMessage Authorized(HttpMethod method, string path, GitHubOptions settings, string accept)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.Token);
        request.Headers.Accept.ParseAdd(accept);
        return request;
    }

    private GitHubOptions RequireSettings()
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.Token) || string.IsNullOrWhiteSpace(settings.Repository))
            throw Failed("GitHub:Token is not configured.");
        return settings;
    }

    private GitHubUnavailableException Failed(string message, Exception? inner = null)
    {
        logger.LogWarning(inner, "{Message}", message);
        return inner is null ? new GitHubUnavailableException(message) : new GitHubUnavailableException(message, inner);
    }

    private sealed record GitHubRelease(
        [property: JsonPropertyName("tag_name")] string? TagName,
        IReadOnlyList<GitHubAsset>? Assets);

    private sealed record GitHubAsset(long Id, string? Name);
}
