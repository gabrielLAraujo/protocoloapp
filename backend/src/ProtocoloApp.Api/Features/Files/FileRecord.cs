namespace ProtocoloApp.Api.Features.Files;

public enum FileKind
{
    ProtocolPdf,
    WorkoutPdf,
    Photo,
    QuestionnairePdf,
    PhotosZip,
    Test,
}

public enum FileStatus
{
    Pending,
    Confirmed,
}

/// <summary>A file in object storage, owned by one user. Pending until the upload is confirmed.</summary>
public sealed class FileRecord
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    /// <summary><c>{userId}/{kind in snake_case}/{id}</c>.</summary>
    public string StorageKey { get; set; } = "";

    public string ContentType { get; set; } = "";

    /// <summary>The size the client announced; confirm checks the stored object against it.</summary>
    public long SizeBytes { get; set; }

    public FileKind Kind { get; set; }

    public FileStatus Status { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
