using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;

namespace ProtocoloApp.Api.Shared.Storage;

/// <summary>Cloudflare R2 through its S3-compatible API (path-style, region <c>auto</c>). Presigning is computed offline.</summary>
public sealed class R2FileStorage : IFileStorage, IDisposable
{
    private readonly AmazonS3Client _client;
    private readonly string _bucket;

    public R2FileStorage(IOptions<StorageOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var settings = options.Value;
        _bucket = settings.Bucket;
        _client = new AmazonS3Client(
            new BasicAWSCredentials(settings.AccessKeyId, settings.SecretAccessKey),
            new AmazonS3Config
            {
                ServiceURL = settings.Endpoint.AbsoluteUri,
                ForcePathStyle = true,
                AuthenticationRegion = "auto",
                // R2 does not accept the optional checksums the v4 SDK adds by default.
                RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
                ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
            });
    }

    public Uri GetUploadUrl(string key, string contentType, long sizeBytes, TimeSpan ttl)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);
        ArgumentException.ThrowIfNullOrEmpty(contentType);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(sizeBytes);

        return Presign(key, HttpVerb.PUT, ttl, contentType);
    }

    public Uri GetDownloadUrl(string key, TimeSpan ttl)
    {
        ArgumentException.ThrowIfNullOrEmpty(key);

        return Presign(key, HttpVerb.GET, ttl, null);
    }

    public async Task<StoredObjectInfo?> HeadAsync(string key, CancellationToken ct)
    {
        try
        {
            var response = await _client.GetObjectMetadataAsync(_bucket, key, ct);
            return new StoredObjectInfo(response.ContentLength, response.Headers.ContentType ?? "");
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<bool> CanReachBucketAsync(CancellationToken ct)
    {
        try
        {
            await _client.ListObjectsV2Async(new ListObjectsV2Request { BucketName = _bucket, MaxKeys = 1 }, ct);
            return true;
        }
        catch (AmazonServiceException)
        {
            return false;
        }
        catch (HttpRequestException)
        {
            return false;
        }
    }

    public void Dispose() => _client.Dispose();

    private Uri Presign(string key, HttpVerb verb, TimeSpan ttl, string? contentType)
    {
        // Whole seconds: the SDK turns the expiry into X-Amz-Expires by subtracting epoch seconds, so a sub-second tail
        // would make 10 minutes come out as 599 or 600 depending on the clock.
        var now = DateTime.UtcNow;
        var expires = new DateTime(now.Ticks - (now.Ticks % TimeSpan.TicksPerSecond), DateTimeKind.Utc) + ttl;
        var request = new GetPreSignedUrlRequest { BucketName = _bucket, Key = key, Verb = verb, Expires = expires };
        if (contentType is not null)
            request.ContentType = contentType;

        return new Uri(_client.GetPreSignedURL(request));
    }
}
