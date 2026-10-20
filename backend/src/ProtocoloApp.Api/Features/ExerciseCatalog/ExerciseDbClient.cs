using System.Text.Json;

namespace ProtocoloApp.Api.Features.ExerciseCatalog;

/// <summary>One exercise as ExerciseDB returns it, already trimmed to what is kept.</summary>
public sealed record ExerciseDbItem(
    string Id,
    string Name,
    string? GifUrl,
    string[] BodyParts,
    string[] TargetMuscles,
    string[] SecondaryMuscles,
    string[] Equipments);

public sealed record ExerciseDbPage(IReadOnlyList<ExerciseDbItem> Items, bool HasNextPage, string? NextCursor);

public interface IExerciseDbClient
{
    /// <summary>One page (25 items); <paramref name="after"/> is the previous page's <c>nextCursor</c>. Null when the request or the format failed.</summary>
    Task<ExerciseDbPage?> GetPageAsync(string? after, CancellationToken ct);
}

/// <summary>
/// Reads <c>GET /api/v1/exercises?limit=25[&amp;after=]</c> from ExerciseDB. The base address is the only host it talks to
/// and redirects are not followed. Only status codes and counts are logged.
/// </summary>
public sealed class ExerciseDbClient(HttpClient http, ILogger<ExerciseDbClient> logger) : IExerciseDbClient
{
    public const string Host = "oss.exercisedb.dev";
    public const string GifPrefix = "https://static.exercisedb.dev/";
    public const int PageSize = 25;

    public static readonly Uri BaseAddress = new($"https://{Host}/");

    public async Task<ExerciseDbPage?> GetPageAsync(string? after, CancellationToken ct)
    {
        var path = $"api/v1/exercises?limit={PageSize}";
        if (!string.IsNullOrEmpty(after))
            path += "&after=" + Uri.EscapeDataString(after);

        try
        {
            using var response = await http.GetAsync(new Uri(path, UriKind.Relative), ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("ExerciseDB page request failed: status {Status}.", (int)response.StatusCode);
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var page = Parse(document.RootElement);
            if (page is null)
                logger.LogWarning("ExerciseDB page had an unexpected format.");
            return page;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or JsonException or IOException)
        {
            logger.LogWarning("ExerciseDB page request failed: {Error}.", ex.GetType().Name);
            return null;
        }
    }

    /// <summary>Null when the document is not the expected envelope; items missing an id or a name are skipped.</summary>
    internal static ExerciseDbPage? Parse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var items = new List<ExerciseDbItem>();
        foreach (var element in data.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
                continue;

            var id = ReadString(element, "exerciseId");
            var name = ReadString(element, "name");
            if (string.IsNullOrWhiteSpace(id) || id.Length > CatalogExercise.MaxIdLength
                || string.IsNullOrWhiteSpace(name) || name.Length > CatalogExercise.MaxNameLength)
            {
                continue;
            }

            items.Add(new ExerciseDbItem(
                id.Trim(),
                name.Trim(),
                SafeGifUrl(ReadString(element, "gifUrl")),
                ReadTags(element, "bodyParts"),
                ReadTags(element, "targetMuscles"),
                ReadTags(element, "secondaryMuscles"),
                ReadTags(element, "equipments")));
        }

        var hasNext = false;
        string? cursor = null;
        if (root.TryGetProperty("meta", out var meta) && meta.ValueKind == JsonValueKind.Object)
        {
            hasNext = meta.TryGetProperty("hasNextPage", out var flag) && flag.ValueKind == JsonValueKind.True;
            cursor = ReadString(meta, "nextCursor");
        }

        return new ExerciseDbPage(items, hasNext, cursor);
    }

    /// <summary>The URL when it is on the static media host (https), otherwise null.</summary>
    internal static string? SafeGifUrl(string? url) =>
        url is not null
        && url.StartsWith(GifPrefix, StringComparison.Ordinal)
        && url.Length <= CatalogExercise.MaxGifUrlLength
        && Uri.TryCreate(url, UriKind.Absolute, out var uri)
        && uri.Host == "static.exercisedb.dev"
            ? url
            : null;

    private static string? ReadString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static string[] ReadTags(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value) || value.ValueKind != JsonValueKind.Array)
            return [];

        return value.EnumerateArray()
            .Where(v => v.ValueKind == JsonValueKind.String)
            .Select(v => v.GetString()!.Trim())
            .Where(v => v.Length is > 0 and <= CatalogExercise.MaxTagLength)
            .Distinct(StringComparer.Ordinal)
            .Take(CatalogExercise.MaxTags)
            .ToArray();
    }
}
