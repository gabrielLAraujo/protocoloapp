using System.Net;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

public sealed class HevyOptions
{
    public const string Section = "Hevy";

    public const string DefaultBaseUrl = "https://api.hevyapp.com/";

    /// <summary>Off keeps the scheduler idle (tests, or an install that does not want to reach Hevy).</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Minutes between scheduled syncs.</summary>
    public int IntervalMinutes { get; set; } = 30;

    /// <summary>https only; plain http is accepted for a loopback host (the E2E stub).</summary>
    public string BaseUrl { get; set; } = DefaultBaseUrl;

    /// <summary>The absolute base address (with a trailing slash) when <paramref name="url"/> is https, or http on a loopback host.</summary>
    public static bool TryGetBaseAddress(string? url, out Uri? baseAddress)
    {
        baseAddress = null;
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri))
            return false;

        var allowed = uri.Scheme == Uri.UriSchemeHttps
            || (uri.Scheme == Uri.UriSchemeHttp && (uri.IsLoopback || IPAddress.TryParse(uri.DnsSafeHost, out var ip) && IPAddress.IsLoopback(ip)));
        if (!allowed || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) || !string.IsNullOrEmpty(uri.UserInfo))
            return false;

        baseAddress = uri.AbsoluteUri.EndsWith('/') ? uri : new Uri(uri.AbsoluteUri + "/");
        return true;
    }
}
