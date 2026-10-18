using System.Collections.Concurrent;
using ProtocoloApp.Api.Shared.Storage;

namespace ProtocoloApp.IntegrationTests.Infra;

/// <summary>In-memory <see cref="IFileStorage"/>: "uploading" is <see cref="Put"/>; URLs are fake.</summary>
public sealed class FakeFileStorage : IFileStorage
{
    private readonly ConcurrentDictionary<string, StoredObjectInfo> _objects = new();

    /// <summary>What <see cref="CanReachBucketAsync"/> answers (the readiness test flips it and restores it).</summary>
    public volatile bool BucketReachable = true;

    public void Put(string key, long sizeBytes, string contentType = "application/pdf") =>
        _objects[key] = new StoredObjectInfo(sizeBytes, contentType);

    public Uri GetUploadUrl(string key, string contentType, long sizeBytes, TimeSpan ttl) =>
        new($"https://storage.test/upload/{key}?ttl={(int)ttl.TotalSeconds}");

    public Uri GetDownloadUrl(string key, TimeSpan ttl) => new($"https://storage.test/download/{key}?ttl={(int)ttl.TotalSeconds}");

    public Task<StoredObjectInfo?> HeadAsync(string key, CancellationToken ct) =>
        Task.FromResult(_objects.TryGetValue(key, out var info) ? info : null);

    public Task<bool> CanReachBucketAsync(CancellationToken ct) => Task.FromResult(BucketReachable);
}
