using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Shared.Storage;

namespace ProtocoloApp.UnitTests.Storage;

/// <summary>
/// Presigning is computed offline: nothing here touches the network (fictitious credentials). A fake clock does not help:
/// the AWS SDK derives X-Amz-Expires from its own DateTime.UtcNow, so the value is the requested TTL minus up to one
/// second when a second boundary falls between our clock read and the SDK's. The assertions allow exactly that second.
/// </summary>
public sealed partial class R2FileStorageTests : IDisposable
{
    private readonly R2FileStorage _storage = new(Options.Create(new StorageOptions
    {
        AccountId = "0123456789abcdef0123456789abcdef",
        AccessKeyId = "test-access-key",
        SecretAccessKey = "test-secret-key-not-real",
        Bucket = "test-bucket",
    }), TimeProvider.System);

    [Fact]
    public void Upload_url_points_to_account_endpoint_and_bucket()
    {
        var url = _storage.GetUploadUrl("user-1/protocol_pdf/file-1", "application/pdf", 1000, TimeSpan.FromMinutes(10));

        Assert.Equal("https", url.Scheme);
        Assert.Equal("0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", url.Host);
        Assert.Equal("/test-bucket/user-1/protocol_pdf/file-1", url.AbsolutePath);
        AssertExpires(url, 600);
        Assert.Contains("X-Amz-Signature=", url.Query, StringComparison.Ordinal);
        // The content type is part of the signature: the upload has to send exactly it.
        Assert.Contains("content-type", Uri.UnescapeDataString(url.Query), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Download_url_expires_in_the_requested_time()
    {
        var url = _storage.GetDownloadUrl("user-1/photo/file-2", TimeSpan.FromMinutes(5));

        Assert.Equal("/test-bucket/user-1/photo/file-2", url.AbsolutePath);
        AssertExpires(url, 300);
    }

    [Fact]
    public void Upload_url_rejects_non_positive_size()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => _storage.GetUploadUrl("k", "application/pdf", 0, TimeSpan.FromMinutes(1)));
    }

    private static void AssertExpires(Uri url, int ttlSeconds)
    {
        var match = ExpiresPattern().Match(url.Query);
        Assert.True(match.Success, "X-Amz-Expires is missing");
        var expires = int.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
        Assert.InRange(expires, ttlSeconds - 1, ttlSeconds);
    }

    public void Dispose() => _storage.Dispose();

    [GeneratedRegex("X-Amz-Expires=(\\d+)")]
    private static partial Regex ExpiresPattern();
}
