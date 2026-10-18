using Microsoft.Extensions.Caching.Memory;

namespace ProtocoloApp.Api.Features.App;

/// <summary>Shared by every request: one GitHub lookup at a time.</summary>
public sealed class ReleaseGate
{
    public SemaphoreSlim Lock { get; } = new(1, 1);
}

/// <summary>
/// The latest release, remembered for a few minutes so the app opening does not hit GitHub's rate limit. Failures and "no release
/// yet" are remembered for a minute too, and concurrent requests on a cold cache share one GitHub call.
/// </summary>
public sealed class ReleaseCache(GitHubReleaseClient github, IMemoryCache cache, ReleaseGate gate)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    public static readonly TimeSpan NegativeLifetime = TimeSpan.FromMinutes(1);

    private const string Key = "app:latest-release";
    private const string NegativeKey = "app:latest-release:negative";

    private sealed record Negative(bool Unavailable);

    /// <exception cref="GitHubUnavailableException">Nothing cached and GitHub cannot answer (also replayed for a minute).</exception>
    public async Task<ReleaseInfo?> GetLatestAsync(CancellationToken ct)
    {
        if (TryCached(out var hit))
            return hit;

        await gate.Lock.WaitAsync(ct);
        try
        {
            // Another request may have filled the cache while this one waited.
            if (TryCached(out hit))
                return hit;

            ReleaseInfo? release;
            try
            {
                release = await github.GetLatestAsync(ct);
            }
            catch (GitHubUnavailableException)
            {
                cache.Set(NegativeKey, new Negative(Unavailable: true), NegativeLifetime);
                throw;
            }

            if (release is null)
                cache.Set(NegativeKey, new Negative(Unavailable: false), NegativeLifetime);
            else
                cache.Set(Key, release, Lifetime);
            return release;
        }
        finally
        {
            gate.Lock.Release();
        }
    }

    /// <summary>Forgets the release (its asset vanished: a newer one was probably published).</summary>
    public void Forget() => cache.Remove(Key);

    private bool TryCached(out ReleaseInfo? release)
    {
        release = null;
        if (cache.TryGetValue(Key, out ReleaseInfo? cached) && cached is not null)
        {
            release = cached;
            return true;
        }

        if (cache.TryGetValue(NegativeKey, out Negative? negative) && negative is not null)
            return negative.Unavailable ? throw new GitHubUnavailableException("GitHub failed a moment ago.") : true;

        return false;
    }
}
