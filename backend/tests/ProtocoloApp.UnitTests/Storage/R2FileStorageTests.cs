using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using ProtocoloApp.Api.Shared.Storage;

namespace ProtocoloApp.UnitTests.Storage;

/// <summary>
/// Presigning is computed offline: nothing here touches the network (fictitious credentials). The clock is fixed on a
/// whole second: with the system clock the expiry came out 1 s short when a second boundary fell during signing.
/// </summary>
public sealed partial class R2FileStorageTests : IDisposable
{
    private readonly R2FileStorage _storage = new(Options.Create(new StorageOptions
    {
        AccountId = "0123456789abcdef0123456789abcdef",
        AccessKeyId = "test-access-key",
        SecretAccessKey = "test-secret-key-not-real",
        Bucket = "test-bucket",
    }), new FakeTimeProvider(new DateTimeOffset(2026, 10, 18, 12, 0, 0, TimeSpan.Zero)));

    [Fact]
    public void Upload_url_points_to_account_endpoint_and_bucket()
    {
        var url = _storage.GetUploadUrl("user-1/protocol_pdf/file-1", "application/pdf", 1000, TimeSpan.FromMinutes(10));

        Assert.Equal("https", url.Scheme);
        Assert.Equal("0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", url.Host);
        Assert.Equal("/test-bucket/user-1/protocol_pdf/file-1", url.AbsolutePath);
        Assert.Contains("X-Amz-Expires=600", url.Query, StringComparison.Ordinal);
        Assert.Contains("X-Amz-Signature=", url.Query, StringComparison.Ordinal);
        // The content type is part of the signature: the upload has to send exactly it.
        Assert.Contains("content-type", Uri.UnescapeDataString(url.Query), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Download_url_expires_in_the_requested_time()
    {
        var url = _storage.GetDownloadUrl("user-1/photo/file-2", TimeSpan.FromMinutes(5));

        Assert.Equal("/test-bucket/user-1/photo/file-2", url.AbsolutePath);
        Assert.Matches(ExpiresPattern(), url.Query);
        Assert.Contains("X-Amz-Expires=300", url.Query, StringComparison.Ordinal);
    }

    [Fact]
    public void Upload_url_rejects_non_positive_size()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => _storage.GetUploadUrl("k", "application/pdf", 0, TimeSpan.FromMinutes(1)));
    }

    public void Dispose() => _storage.Dispose();

    [GeneratedRegex("X-Amz-Expires=\\d+")]
    private static partial Regex ExpiresPattern();
}
