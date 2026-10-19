using System.Collections.Concurrent;
using ProtocoloApp.Api.Shared.Storage;

namespace ProtocoloApp.IntegrationTests.Infra;

/// <summary>In-memory <see cref="IFileStorage"/>: "uploading" is <see cref="Put"/>; URLs are fake.</summary>
public sealed class FakeFileStorage : IFileStorage
{
    private readonly ConcurrentDictionary<string, StoredObjectInfo> _objects = new();
    private readonly ConcurrentDictionary<string, byte[]> _contents = new();

    /// <summary>What <see cref="CanReachBucketAsync"/> answers (the readiness test flips it and restores it).</summary>
    public volatile bool BucketReachable = true;

    /// <summary>When set, the readiness probe never answers (until its token is cancelled).</summary>
    public volatile bool HangBucketCheck;

    public void Put(string key, long sizeBytes, string contentType = "application/pdf") =>
        _objects[key] = new StoredObjectInfo(sizeBytes, contentType);

    /// <summary>Stores an object with real bytes (what <see cref="OpenReadAsync"/> returns).</summary>
    public void Put(string key, byte[] content, string contentType = "application/pdf")
    {
        _objects[key] = new StoredObjectInfo(content.Length, contentType);
        _contents[key] = content;
    }

    public Task<Stream> OpenReadAsync(string key, CancellationToken ct)
    {
        if (!_objects.ContainsKey(key))
            throw new FileNotFoundException("No such object.");

        return Task.FromResult<Stream>(new MemoryStream(_contents.TryGetValue(key, out var content) ? content : []));
    }

    public Uri GetUploadUrl(string key, string contentType, long sizeBytes, TimeSpan ttl) =>
        new($"https://storage.test/upload/{key}?ttl={(int)ttl.TotalSeconds}");

    public Uri GetDownloadUrl(string key, TimeSpan ttl) => new($"https://storage.test/download/{key}?ttl={(int)ttl.TotalSeconds}");

    public Task<StoredObjectInfo?> HeadAsync(string key, CancellationToken ct) =>
        Task.FromResult(_objects.TryGetValue(key, out var info) ? info : null);

    public async Task<bool> CanReachBucketAsync(CancellationToken ct)
    {
        if (HangBucketCheck)
            await Task.Delay(Timeout.Infinite, ct);

        return BucketReachable;
    }
}
