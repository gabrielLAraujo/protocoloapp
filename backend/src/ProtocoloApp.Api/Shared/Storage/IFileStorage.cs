namespace ProtocoloApp.Api.Shared.Storage;

/// <summary>Object storage behind presigned URLs: the API never proxies file bytes.</summary>
public interface IFileStorage
{
    /// <summary>A URL the client PUTs the file to. The content type is part of the signature (the upload must send exactly it).</summary>
    /// <remarks>
    /// The size cannot be enforced by a presigned URL: the control is <see cref="HeadAsync"/> after the upload, which the
    /// confirm endpoint compares with the size the client announced.
    /// </remarks>
    Uri GetUploadUrl(string key, string contentType, long sizeBytes, TimeSpan ttl);

    Uri GetDownloadUrl(string key, TimeSpan ttl);

    /// <summary>Size and content type of the stored object, or <see langword="null"/> when there is no such object.</summary>
    Task<StoredObjectInfo?> HeadAsync(string key, CancellationToken ct);

    /// <summary>Whether the configured bucket answers with the configured credentials (readiness check).</summary>
    Task<bool> CanReachBucketAsync(CancellationToken ct);
}

public sealed record StoredObjectInfo(long SizeBytes, string ContentType);
