using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests;

/// <summary>The front the API serves (a Vite build in <c>wwwroot</c>): what browsers and the service worker may cache.</summary>
public sealed class SpaHostingTests : IDisposable, IClassFixture<ApiFactory>
{
    // As the framework normalizes the header (the code sets it without spaces).
    private const string Immutable = "public, max-age=31536000, immutable";
    private const string Revalidate = "no-cache";

    private readonly string _wwwroot = Directory.CreateTempSubdirectory("protocoloapp-wwwroot-").FullName;
    private readonly WebApplicationFactory<Program> _factory;

    public SpaHostingTests(ApiFactory factory)
    {
        Directory.CreateDirectory(Path.Combine(_wwwroot, "assets"));
        File.WriteAllText(Path.Combine(_wwwroot, "index.html"), "<!doctype html><title>Protocolo</title>");
        File.WriteAllText(Path.Combine(_wwwroot, "sw.js"), "// service worker");
        File.WriteAllText(Path.Combine(_wwwroot, "registerSW.js"), "// loader");
        File.WriteAllText(Path.Combine(_wwwroot, "manifest.webmanifest"), "{\"name\":\"Protocolo\"}");
        File.WriteAllText(Path.Combine(_wwwroot, "pwa-192.png"), "not really a png");
        File.WriteAllText(Path.Combine(_wwwroot, "assets", "index-Ab12Cd34.js"), "console.log(1)");
        File.WriteAllText(Path.Combine(_wwwroot, "assets", "sql-wasm.wasm"), "not really wasm");

        // The same API, now with a front to serve (the base factory has no wwwroot, so it does not map the fallback).
        _factory = factory.WithWebHostBuilder(builder => builder.UseWebRoot(_wwwroot));
    }

    public void Dispose()
    {
        _factory.Dispose();
        Directory.Delete(_wwwroot, recursive: true);
    }

    [Theory]
    [InlineData("/sw.js")]
    [InlineData("/registerSW.js")]
    [InlineData("/manifest.webmanifest")]
    [InlineData("/index.html")]
    [InlineData("/pwa-192.png")]
    public async Task Fixed_name_files_are_revalidated_on_every_visit(string path)
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync(new Uri(path, UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Revalidate, Assert.Single(response.Headers.GetValues("Cache-Control")));
    }

    [Fact]
    public async Task Hashed_assets_are_cached_for_a_year_and_never_revalidated()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync(new Uri("/assets/index-Ab12Cd34.js", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Immutable, Assert.Single(response.Headers.GetValues("Cache-Control")));
    }

    [Fact]
    public async Task Unhashed_files_under_assets_are_revalidated()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync(new Uri("/assets/sql-wasm.wasm", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(Revalidate, Assert.Single(response.Headers.GetValues("Cache-Control")));
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/settings/diagnostics")]
    public async Task Front_routes_return_index_html_and_are_revalidated(string path)
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync(new Uri(path, UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains("<title>Protocolo</title>", await response.Content.ReadAsStringAsync());
        Assert.Equal(Revalidate, Assert.Single(response.Headers.GetValues("Cache-Control")));
    }

    [Fact]
    public async Task Web_manifest_is_served_with_its_own_media_type()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync(new Uri("/manifest.webmanifest", UriKind.Relative));

        Assert.Equal("application/manifest+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Unknown_api_route_is_not_swallowed_by_the_fallback()
    {
        using var client = _factory.CreateClient();

        var response = await client.GetAsync(new Uri("/api/nao-existe", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }
}
