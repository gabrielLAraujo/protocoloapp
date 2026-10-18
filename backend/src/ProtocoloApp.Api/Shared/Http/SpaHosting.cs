using Microsoft.AspNetCore.StaticFiles;

namespace ProtocoloApp.Api.Shared.Http;

/// <summary>
/// Serves the front (Vite build copied to <c>wwwroot</c>) from the API itself, on the same origin (no CORS).
/// Without <c>wwwroot/index.html</c> (tests, development with the Vite server) the fallback is not even mapped.
/// </summary>
public static class SpaHosting
{
    private const string IndexFile = "index.html";

    // Files under /assets carry a content hash in their name (Vite renames them on every change), so they never change.
    private const string ImmutableCache = "public,max-age=31536000,immutable";

    // Everything else (index.html, icons) is revalidated on every visit: a new deploy shows up at once, and the ETag avoids the download.
    private const string RevalidateCache = "no-cache";

    // Front routes: any path without a file extension that belongs neither to the API nor to the docs/health endpoints.
    // The fallback must never swallow /api (unknown routes must keep returning the API's 404), /health, /openapi or /scalar;
    // the regex anchors at the start of the path and covers the whole prefix ("api" or "api/...", but not "apiary").
    private const string FallbackPattern = "{*path:nonfile:regex(^(?!(api|health|openapi|scalar)(/|$)).*$)}";

    /// <summary>Static files from <c>wwwroot</c>, before authentication: no login or rate limit applies.</summary>
    public static IApplicationBuilder UseSpaStaticFiles(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        return app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse = PrepareFileResponse });
    }

    /// <summary>
    /// Any front route the browser requests directly (<c>/today?day=2026-10-18</c> on F5) returns <c>index.html</c>
    /// and the React router resolves it. Call after mapping the endpoints.
    /// </summary>
    public static void MapSpaFallback(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        if (!app.Environment.WebRootFileProvider.GetFileInfo(IndexFile).Exists)
            return;

        var options = new StaticFileOptions { OnPrepareResponse = PrepareIndexResponse };

        // The root is mapped separately: the regex of FallbackPattern only accepts paths with a value, and "/" has none.
        app.MapFallbackToFile("/", IndexFile, options).ExcludeFromDescription().AllowAnonymous();
        app.MapFallbackToFile(FallbackPattern, IndexFile, options).ExcludeFromDescription().AllowAnonymous();
    }

    // Only files that exist in wwwroot get here; under /assets, the hashed build output.
    private static void PrepareFileResponse(StaticFileResponseContext context) =>
        context.Context.Response.Headers.CacheControl =
            context.Context.Request.Path.StartsWithSegments("/assets") ? ImmutableCache : RevalidateCache;

    // index.html standing in for a front route is always revalidated, whatever path was requested.
    private static void PrepareIndexResponse(StaticFileResponseContext context) =>
        context.Context.Response.Headers.CacheControl = RevalidateCache;
}
