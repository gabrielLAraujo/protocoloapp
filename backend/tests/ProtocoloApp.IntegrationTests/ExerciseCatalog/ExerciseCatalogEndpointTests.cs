using System.Net;
using System.Net.Http.Json;
using ProtocoloApp.Api.Features.ExerciseCatalog;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.ExerciseCatalog;

[Collection("api")]
public sealed class ExerciseCatalogEndpointTests(ApiFactory factory)
{
    private static readonly Uri Route = new("/api/exercise-catalog", UriKind.Relative);

    private static readonly DateTimeOffset At = new(2026, 10, 20, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Requires_authentication()
    {
        using var client = factory.CreateClientWithOwnIp();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(Route)).StatusCode);
    }

    [Fact]
    public async Task Returns_the_items_sorted_by_name_with_a_version_and_an_etag()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, At, "z-id", "a-id", "m-id");
        using var client = await factory.CreateAuthenticatedClientAsync();

        var response = await client.GetAsync(Route);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<CatalogResponse>())!;
        Assert.Equal(["a-id", "m-id", "z-id"], body.Items.Select(i => i.Id));
        var first = body.Items[0];
        Assert.Equal("exercise a-id", first.Name);
        Assert.Equal(["upper arms"], first.BodyParts);
        Assert.Equal(["biceps"], first.TargetMuscles);
        Assert.Equal(["cable"], first.Equipments);
        Assert.Equal("https://static.exercisedb.dev/media/a-id.gif", first.GifUrl);
        Assert.Equal($"\"{body.Version}\"", response.Headers.ETag!.Tag);
        Assert.EndsWith("-3", body.Version, StringComparison.Ordinal);
    }

    [Fact]
    public async Task If_none_match_with_the_current_etag_returns_304_without_body()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, At, "e1", "e2");
        using var client = await factory.CreateAuthenticatedClientAsync();
        var first = await client.GetAsync(Route);
        var etag = first.Headers.ETag!.Tag;

        using var request = new HttpRequestMessage(HttpMethod.Get, Route);
        request.Headers.TryAddWithoutValidation("If-None-Match", etag);
        var second = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotModified, second.StatusCode);
        Assert.Equal(etag, second.Headers.ETag!.Tag);
        Assert.Empty(await second.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_changed_catalog_changes_the_version_so_the_old_etag_gets_200()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, At, "v1");
        using var client = await factory.CreateAuthenticatedClientAsync();
        var etag = (await client.GetAsync(Route)).Headers.ETag!.Tag;
        await CatalogData.SeedAsync(factory, At.AddDays(1), "v2");

        using var request = new HttpRequestMessage(HttpMethod.Get, Route);
        request.Headers.TryAddWithoutValidation("If-None-Match", etag);
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, (await response.Content.ReadFromJsonAsync<CatalogResponse>())!.Items.Count);
    }

    [Fact]
    public async Task The_response_is_compressed_when_the_client_accepts_gzip()
    {
        await CatalogData.ResetAsync(factory);
        await CatalogData.SeedAsync(factory, At, "gz1", "gz2");
        using var client = await factory.CreateAuthenticatedClientAsync();

        using var request = new HttpRequestMessage(HttpMethod.Get, Route);
        request.Headers.TryAddWithoutValidation("Accept-Encoding", "gzip");
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("gzip", response.Content.Headers.ContentEncoding);
    }

    [Fact]
    public async Task An_empty_catalog_returns_an_empty_list()
    {
        await CatalogData.ResetAsync(factory);
        using var client = await factory.CreateAuthenticatedClientAsync();

        var body = (await client.GetFromJsonAsync<CatalogResponse>(Route))!;

        Assert.Empty(body.Items);
        Assert.Equal("0-0", body.Version);
    }
}
