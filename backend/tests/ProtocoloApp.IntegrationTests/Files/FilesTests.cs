using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Files;

[Collection("api")]
public sealed class FilesTests(ApiFactory factory)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    [Fact]
    public async Task Upload_confirm_download_flow()
    {
        using var client = await factory.CreateAuthenticatedClientAsync();

        var upload = await RequestUploadAsync(client, FileKind.ProtocolPdf, "application/pdf", 1234);
        Assert.Equal(HttpStatusCode.OK, upload.StatusCode);
        var created = (await upload.Content.ReadFromJsonAsync<UploadUrlResponse>(Json))!;
        Assert.Contains(created.FileId.ToString(), created.UploadUrl.AbsoluteUri, StringComparison.Ordinal);
        Assert.Contains("/protocol_pdf/", created.UploadUrl.AbsoluteUri, StringComparison.Ordinal);
        Assert.True(created.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(9));
        Assert.True(created.ExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(10));

        // The client uploads straight to the storage.
        factory.Storage.Put(await StorageKeyAsync(created.FileId), 1234);

        var confirm = await client.PostAsync(new Uri($"/api/files/{created.FileId}/confirm", UriKind.Relative), content: null);
        Assert.Equal(HttpStatusCode.NoContent, confirm.StatusCode);

        var download = await client.GetAsync(new Uri($"/api/files/{created.FileId}/download-url", UriKind.Relative));
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        var body = (await download.Content.ReadFromJsonAsync<DownloadUrlResponse>(Json))!;
        Assert.Contains("/download/", body.Url.AbsoluteUri, StringComparison.Ordinal);
        Assert.True(body.ExpiresAt > DateTimeOffset.UtcNow.AddMinutes(4));
        Assert.True(body.ExpiresAt <= DateTimeOffset.UtcNow.AddMinutes(5));
    }

    [Fact]
    public async Task Confirm_without_object_returns_409()
    {
        using var client = await factory.CreateAuthenticatedClientAsync();
        var created = await CreateAsync(client);

        var confirm = await client.PostAsync(new Uri($"/api/files/{created.FileId}/confirm", UriKind.Relative), content: null);

        Assert.Equal(HttpStatusCode.Conflict, confirm.StatusCode);
        Assert.Equal("application/problem+json", confirm.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Confirm_with_different_size_returns_409_and_stays_pending()
    {
        using var client = await factory.CreateAuthenticatedClientAsync();
        var created = await CreateAsync(client, sizeBytes: 100);
        factory.Storage.Put(await StorageKeyAsync(created.FileId), 101);

        var confirm = await client.PostAsync(new Uri($"/api/files/{created.FileId}/confirm", UriKind.Relative), content: null);
        var download = await client.GetAsync(new Uri($"/api/files/{created.FileId}/download-url", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Conflict, confirm.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, download.StatusCode);
    }

    [Fact]
    public async Task Download_of_pending_file_returns_409()
    {
        using var client = await factory.CreateAuthenticatedClientAsync();
        var created = await CreateAsync(client);

        var download = await client.GetAsync(new Uri($"/api/files/{created.FileId}/download-url", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Conflict, download.StatusCode);
    }

    [Theory]
    [InlineData(26_214_401L)]
    [InlineData(0L)]
    [InlineData(-5L)]
    public async Task Size_out_of_range_returns_400(long size)
    {
        using var client = await factory.CreateAuthenticatedClientAsync();

        var response = await RequestUploadAsync(client, FileKind.ProtocolPdf, "application/pdf", size);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Size_of_exactly_25MB_is_accepted()
    {
        using var client = await factory.CreateAuthenticatedClientAsync();

        var response = await RequestUploadAsync(client, FileKind.PhotosZip, "application/zip", 26_214_400L);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData(FileKind.ProtocolPdf, "image/png")]
    [InlineData(FileKind.WorkoutPdf, "text/plain")]
    [InlineData(FileKind.QuestionnairePdf, "application/zip")]
    [InlineData(FileKind.Photo, "application/pdf")]
    [InlineData(FileKind.Photo, "image/gif")]
    [InlineData(FileKind.PhotosZip, "image/jpeg")]
    [InlineData(FileKind.Test, "application/x-msdownload")]
    [InlineData(FileKind.Photo, "")]
    public async Task Disallowed_content_type_returns_400(FileKind kind, string contentType)
    {
        using var client = await factory.CreateAuthenticatedClientAsync();

        var response = await RequestUploadAsync(client, kind, contentType, 10);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData(FileKind.ProtocolPdf, "application/pdf")]
    [InlineData(FileKind.WorkoutPdf, "application/pdf")]
    [InlineData(FileKind.QuestionnairePdf, "application/pdf")]
    [InlineData(FileKind.Photo, "image/jpeg")]
    [InlineData(FileKind.Photo, "image/png")]
    [InlineData(FileKind.Photo, "image/webp")]
    [InlineData(FileKind.PhotosZip, "application/zip")]
    [InlineData(FileKind.Test, "text/plain")]
    public async Task Allowed_content_type_returns_200(FileKind kind, string contentType)
    {
        using var client = await factory.CreateAuthenticatedClientAsync();

        var response = await RequestUploadAsync(client, kind, contentType, 10);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Unknown_kind_returns_400()
    {
        using var client = await factory.CreateAuthenticatedClientAsync();

        var response = await client.PostAsJsonAsync(
            new Uri("/api/files/upload-url", UriKind.Relative),
            new { kind = 99, contentType = "application/pdf", sizeBytes = 10 });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Other_user_file_returns_404()
    {
        using var owner = await factory.CreateAuthenticatedClientAsync($"{Guid.NewGuid():N}@example.com");
        using var other = await factory.CreateAuthenticatedClientAsync($"{Guid.NewGuid():N}@example.com");
        var created = await CreateAsync(owner);
        factory.Storage.Put(await StorageKeyAsync(created.FileId), 1000);
        (await owner.PostAsync(new Uri($"/api/files/{created.FileId}/confirm", UriKind.Relative), content: null)).EnsureSuccessStatusCode();

        var confirm = await other.PostAsync(new Uri($"/api/files/{created.FileId}/confirm", UriKind.Relative), content: null);
        var download = await other.GetAsync(new Uri($"/api/files/{created.FileId}/download-url", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, confirm.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, download.StatusCode);
    }

    [Fact]
    public async Task Unknown_file_returns_404()
    {
        using var client = await factory.CreateAuthenticatedClientAsync();

        var response = await client.GetAsync(new Uri($"/api/files/{Guid.NewGuid()}/download-url", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Storage_key_is_user_kind_and_id()
    {
        using var client = await factory.CreateAuthenticatedClientAsync();
        var created = await CreateAsync(client, FileKind.PhotosZip, "application/zip");

        await using var scope = factory.Services.CreateAsyncScope();
        var file = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Files.SingleAsync(f => f.Id == created.FileId);

        Assert.Equal($"{file.UserId}/photos_zip/{file.Id}", file.StorageKey);
        Assert.Equal(FileStatus.Pending, file.Status);
    }

    [Fact]
    public async Task Files_endpoints_require_a_login()
    {
        using var client = factory.CreateClientWithOwnIp();

        var response = await client.PostAsJsonAsync(
            new Uri("/api/files/upload-url", UriKind.Relative),
            new UploadUrlRequest(FileKind.Test, "text/plain", 10),
            Json);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private static Task<HttpResponseMessage> RequestUploadAsync(HttpClient client, FileKind kind, string contentType, long sizeBytes) =>
        client.PostAsJsonAsync(new Uri("/api/files/upload-url", UriKind.Relative), new UploadUrlRequest(kind, contentType, sizeBytes), Json);

    private static async Task<UploadUrlResponse> CreateAsync(
        HttpClient client,
        FileKind kind = FileKind.ProtocolPdf,
        string contentType = "application/pdf",
        long sizeBytes = 1000)
    {
        var response = await RequestUploadAsync(client, kind, contentType, sizeBytes);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<UploadUrlResponse>(Json))!;
    }

    private async Task<string> StorageKeyAsync(Guid fileId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Files
            .Where(f => f.Id == fileId).Select(f => f.StorageKey).SingleAsync();
    }
}
