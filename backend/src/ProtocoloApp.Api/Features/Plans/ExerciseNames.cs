using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>
/// The key that matches the same exercise written differently in different PDFs ("Supino inclinado c/ halteres" and
/// "supino inclinado halteres").
/// </summary>
public static partial class ExerciseNames
{
    private static readonly HashSet<string> FillerWords = new(["com", "de", "no", "na", "em"], StringComparer.Ordinal);

    /// <summary>Lowercase, no accents, no punctuation, without <c>c/</c>, <c>com</c>, <c>de</c>, <c>no</c>, <c>na</c>, <c>em</c>; single spaces.</summary>
    public static string Normalize(string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        var lower = name.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var plain = new StringBuilder(lower.Length);
        foreach (var c in lower)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                plain.Append(c);
        }

        var withoutAbbreviation = AbbreviatedWith().Replace(plain.ToString(), " ");
        var letters = new StringBuilder(withoutAbbreviation.Length);
        foreach (var c in withoutAbbreviation)
            letters.Append(char.IsLetterOrDigit(c) ? c : ' ');

        var words = letters.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => !FillerWords.Contains(w));
        return string.Join(' ', words);
    }

    // "c/" as a word of its own ("c/ halteres", "supino c/halteres"), not the end of another word.
    [GeneratedRegex(@"(?<![\p{L}\p{N}])c/", RegexOptions.CultureInvariant)]
    private static partial Regex AbbreviatedWith();
}
