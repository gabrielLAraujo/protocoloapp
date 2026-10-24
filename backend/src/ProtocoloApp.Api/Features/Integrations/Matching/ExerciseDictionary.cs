using System.Text.Json;

namespace ProtocoloApp.Api.Features.Integrations.Matching;

/// <summary>One entry of the pt-BR exercise dictionary (<c>frontend/src/domain/exercise-dictionary.json</c>).</summary>
public sealed record DictionaryEntry(string Key, string Name, string[] Aliases, string Group, string Equipment, string? CatalogId);

/// <summary>
/// The front's pt-BR exercise dictionary, embedded in the assembly (<c>exercise-dictionary.json</c>, see the csproj and
/// the Dockerfile) and read once. The front's file is the single source of truth.
/// </summary>
public static class ExerciseDictionary
{
    public const string ResourceName = "exercise-dictionary.json";

    private static readonly Lazy<IReadOnlyList<DictionaryEntry>> Loaded = new(Load);

    public static IReadOnlyList<DictionaryEntry> Entries => Loaded.Value;

    private static IReadOnlyList<DictionaryEntry> Load()
    {
        using var stream = typeof(ExerciseDictionary).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource {ResourceName} not found.");
        var document = JsonSerializer.Deserialize<DictionaryDocument>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException($"Embedded resource {ResourceName} is empty.");
        return document.Entries
            .Select(e => new DictionaryEntry(e.Key, e.Name, e.Aliases, e.Group, e.Equipment, e.CatalogId))
            .ToList();
    }

    private sealed record DictionaryDocument(int Version, List<EntryDocument> Entries);

    private sealed record EntryDocument(string Key, string Name, string[] Aliases, string Group, string Equipment, string? CatalogId);
}
