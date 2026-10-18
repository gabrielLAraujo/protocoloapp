namespace ProtocoloApp.Api.Features.Files;

public sealed record UploadUrlRequest(FileKind Kind, string ContentType, long SizeBytes);

public sealed record UploadUrlResponse(Guid FileId, Uri UploadUrl, DateTimeOffset ExpiresAt);

public sealed record DownloadUrlResponse(Uri Url, DateTimeOffset ExpiresAt);
