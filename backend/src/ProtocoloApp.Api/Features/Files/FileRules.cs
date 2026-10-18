using System.Text;

namespace ProtocoloApp.Api.Features.Files;

/// <summary>Limits, allowed content types and key layout of stored files.</summary>
public static class FileRules
{
    public const long MaxSizeBytes = 25L * 1024 * 1024;

    public static readonly TimeSpan UploadUrlTtl = TimeSpan.FromMinutes(10);

    public static readonly TimeSpan DownloadUrlTtl = TimeSpan.FromMinutes(5);

    private const string Pdf = "application/pdf";
    private const string Zip = "application/zip";
    private const string Text = "text/plain";

    private static readonly string[] Images = ["image/jpeg", "image/png", "image/webp"];

    /// <summary>Whether a file of this kind may have this content type (exact, case-insensitive; no parameters).</summary>
    public static bool IsAllowed(FileKind kind, string? contentType)
    {
        if (string.IsNullOrWhiteSpace(contentType))
            return false;

        return kind switch
        {
            FileKind.ProtocolPdf or FileKind.WorkoutPdf or FileKind.QuestionnairePdf => Matches(contentType, Pdf),
            FileKind.Photo => Images.Any(t => Matches(contentType, t)),
            FileKind.PhotosZip => Matches(contentType, Zip),
            // Text is only for the smoke-test kind; it also takes any of the real types.
            FileKind.Test => Matches(contentType, Text) || Matches(contentType, Pdf) || Matches(contentType, Zip) || Images.Any(t => Matches(contentType, t)),
            _ => false,
        };
    }

    public static string StorageKey(Guid userId, FileKind kind, Guid id) => $"{userId}/{SnakeCase(kind)}/{id}";

    private static bool Matches(string value, string allowed) => string.Equals(value, allowed, StringComparison.OrdinalIgnoreCase);

    private static string SnakeCase(FileKind kind)
    {
        var name = kind.ToString();
        var builder = new StringBuilder(name.Length + 2);
        for (var i = 0; i < name.Length; i++)
        {
            if (char.IsUpper(name[i]) && i > 0)
                builder.Append('_');
            builder.Append(char.ToLowerInvariant(name[i]));
        }

        return builder.ToString();
    }
}
