using Microsoft.Extensions.Caching.Memory;

namespace ProtocoloApp.Api.Features.App;

/// <summary>The latest release, remembered for a few minutes so the app opening does not hit GitHub's rate limit.</summary>
public sealed class ReleaseCache(GitHubReleaseClient github, IMemoryCache cache)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    private const string Key = "app:latest-release";

    /// <exception cref="GitHubUnavailableException">Nothing cached and GitHub cannot answer.</exception>
    public async Task<ReleaseInfo?> GetLatestAsync(CancellationToken ct)
    {
        if (cache.TryGetValue(Key, out ReleaseInfo? cached) && cached is not null)
            return cached;

        var release = await github.GetLatestAsync(ct);
        if (release is not null)
            cache.Set(Key, release, Lifetime);
        return release;
    }

    /// <summary>Forgets the release (its asset vanished: a newer one was probably published).</summary>
    public void Forget() => cache.Remove(Key);
}
