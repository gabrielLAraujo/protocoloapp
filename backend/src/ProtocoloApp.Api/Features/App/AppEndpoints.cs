using Microsoft.AspNetCore.Http.HttpResults;

namespace ProtocoloApp.Api.Features.App;

/// <summary>
/// Update check for the Android app: <c>latest-release</c> tells the newest version, <c>apk</c> streams its file. The repository is
/// private, so the app cannot reach GitHub itself: the API does, with its own token, and proxies the download.
/// </summary>
public static class AppEndpoints
{
    public const string ApkContentType = "application/vnd.android.package-archive";

    public static void MapApp(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        var group = api.MapGroup("/app").WithTags("App");
        group.MapGet("/latest-release", LatestReleaseAsync);
        group.MapGet("/apk", ApkAsync)
            .Produces(StatusCodes.Status200OK, contentType: ApkContentType)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
    }

    private static async Task<Results<Ok<LatestReleaseResponse>, ProblemHttpResult>> LatestReleaseAsync(
        HttpRequest request,
        ReleaseCache releases,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(releases);

        try
        {
            var release = await releases.GetLatestAsync(ct);
            if (release is null)
                return NoRelease();

            var apkUrl = new Uri($"{request.Scheme}://{request.Host}{request.PathBase}/api/app/apk");
            return TypedResults.Ok(new LatestReleaseResponse(release.Version, apkUrl));
        }
        catch (GitHubUnavailableException)
        {
            return Unavailable();
        }
    }

    private static async Task<IResult> ApkAsync(ReleaseCache releases, GitHubReleaseClient github, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(releases);
        ArgumentNullException.ThrowIfNull(github);

        ReleaseInfo? release;
        HttpResponseMessage response;
        try
        {
            release = await releases.GetLatestAsync(ct);
            if (release is null)
                return NoRelease();
            response = await github.OpenAssetAsync(release.ApkAssetId, ct);
        }
        catch (GitHubUnavailableException)
        {
            // The cached asset id may belong to a release that was replaced: look again next time.
            releases.Forget();
            return Unavailable();
        }

        return Results.Stream(
            async output =>
            {
                using (response)
                {
                    await using var source = await response.Content.ReadAsStreamAsync(ct);
                    await source.CopyToAsync(output, ct);
                }
            },
            ApkContentType,
            $"protocolo-{release.Version}.apk");
    }

    private static ProblemHttpResult NoRelease() =>
        TypedResults.Problem(title: "Nenhuma versão publicada", detail: "Ainda não há um APK publicado.", statusCode: StatusCodes.Status404NotFound);

    private static ProblemHttpResult Unavailable() =>
        TypedResults.Problem(
            title: "Atualizações indisponíveis",
            detail: "Não foi possível consultar as versões do app agora. Tente de novo mais tarde.",
            statusCode: StatusCodes.Status503ServiceUnavailable);
}
