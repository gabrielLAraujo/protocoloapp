using System.Text;
using System.Text.RegularExpressions;

namespace ProtocoloApp.Api.Features.Integrations.Matching;

/// <summary>
/// The exact-match part of <c>frontend/src/domain/exerciseMatch.ts</c>, ported verbatim: <c>normalizeExerciseName</c>,
/// <c>foldWord</c>, the equipment words and <c>exactKey</c>. Any change there must be mirrored here (shared cases in
/// <c>fixtures/exercise-match-cases.json</c>). The fuzzy part stays on the device.
/// </summary>
public static partial class ExerciseWords
{
    /// <summary>Words that describe how a set is performed, not which exercise it is, plus filler words.</summary>
    private static readonly HashSet<string> IgnoredWords = new(StringComparer.Ordinal)
    {
        // filler
        "a", "o", "e", "c", "com", "de", "da", "do", "das", "dos", "no", "na", "nos", "nas", "em", "x",
        // techniques and set notes
        "pico", "contracao", "contracoes", "seg", "segs", "segundo", "segundos", "drop", "drops", "dropset",
        "intervalo", "isometria", "rest", "pause", "restpause", "pausa", "biset", "bi", "set", "triset", "sst",
        "parcial", "parciais", "falha", "cadencia", "lento", "negativa", "negativas", "progressiva", "carga",
        "reps", "rep", "repeticoes", "series", "serie", "tecnica", "graus", "kg",
    };

    /// <summary>Equipment words, by their canonical token.</summary>
    private static readonly Dictionary<string, string> EquipmentWords = new(StringComparer.Ordinal)
    {
        ["barra"] = "barra", ["barras"] = "barra", ["livre"] = "barra",
        ["halter"] = "halter", ["halteres"] = "halter", ["haltere"] = "halter", ["halters"] = "halter", ["hbc"] = "halter",
        ["maquina"] = "maquina", ["maquinas"] = "maquina", ["aparelho"] = "maquina", ["articulado"] = "maquina", ["articulada"] = "maquina",
        ["polia"] = "polia", ["polias"] = "polia", ["cabo"] = "polia", ["cabos"] = "polia",
        ["smith"] = "smith",
        ["anilha"] = "anilha",
    };

    /// <summary>Canonical equipment token of a dictionary entry's <c>equipment</c> (<c>EQUIPMENT_TOKEN</c>); null for the rest.</summary>
    public static string? EquipmentToken(string equipment) => equipment switch
    {
        "barbell" => "barra",
        "dumbbell" => "halter",
        "machine" => "maquina",
        "cable" => "polia",
        "smith" => "smith",
        _ => null,
    };

    /// <summary>A number with an optional unit or set notation: <c>45</c>, <c>3x12</c>, <c>10kg</c>, <c>30s</c> (ASCII digits, as in JS).</summary>
    [GeneratedRegex(@"^[0-9]+([.,][0-9]+)?(x[0-9]+)*(kg|s|seg|min|rep|reps|graus|o)?$", RegexOptions.CultureInvariant)]
    private static partial Regex NumberToken();

    [GeneratedRegex(@"\p{M}", RegexOptions.CultureInvariant)]
    private static partial Regex Marks();

    [GeneratedRegex(@"\([^)]*\)|\[[^\]]*\]", RegexOptions.CultureInvariant)]
    private static partial Regex Bracketed();

    [GeneratedRegex(@"(?<![\p{L}\p{N}])c/", RegexOptions.CultureInvariant)]
    private static partial Regex WithAbbreviation();

    [GeneratedRegex(@"[^\p{L}\p{N}]+", RegexOptions.CultureInvariant)]
    private static partial Regex NonWord();

    [GeneratedRegex(@"\(([^)]*)\)", RegexOptions.CultureInvariant)]
    private static partial Regex Parenthesized();

    [GeneratedRegex(@"(?<![\p{L}\p{N}])smith machine(?![\p{L}\p{N}])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex SmithMachine();

    [GeneratedRegex(@"(?<![\p{L}\p{N}])barbell(?![\p{L}\p{N}])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Barbell();

    [GeneratedRegex(@"(?<![\p{L}\p{N}])dumbbell(?![\p{L}\p{N}])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Dumbbell();

    [GeneratedRegex(@"(?<![\p{L}\p{N}])cable(?![\p{L}\p{N}])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Cable();

    [GeneratedRegex(@"(?<![\p{L}\p{N}])machine(?![\p{L}\p{N}])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Machine();

    /// <summary>
    /// The comparable form of an exercise name (<c>normalizeExerciseName</c>): lowercase, no accents, no parenthetical
    /// text, no punctuation, no numbers with units, without technique and filler words; single spaces.
    /// </summary>
    public static string Normalize(string name)
    {
        var text = Marks().Replace(name.ToLowerInvariant().Normalize(NormalizationForm.FormD), "");
        text = Bracketed().Replace(text, " ");
        text = WithAbbreviation().Replace(text, " ");
        text = NonWord().Replace(text, " ");
        return string.Join(' ', text
            .Split(' ')
            .Where(word => word.Length > 0 && !NumberToken().IsMatch(word) && !IgnoredWords.Contains(word)));
    }

    /// <summary>Folds gender and number (<c>foldWord</c>): <c>sentada</c>, <c>sentados</c> → <c>sentado</c>; <c>flexoes</c> → <c>flexao</c>.</summary>
    public static string Fold(string word)
    {
        var w = word;
        if (w.Length > 4 && w.EndsWith("oes", StringComparison.Ordinal)) w = string.Concat(w.AsSpan(0, w.Length - 3), "ao");
        if (w.Length > 3 && w.EndsWith('s')) w = w[..^1];
        if (w.Length > 3 && (w.EndsWith('a') || w.EndsWith('o'))) w = string.Concat(w.AsSpan(0, w.Length - 1), "o");
        return w;
    }

    /// <summary>Core words (folded, in order) and canonical equipment tokens (distinct, in order of appearance).</summary>
    public static (IReadOnlyList<string> Core, IReadOnlyList<string> Equipment) Words(string name)
    {
        var core = new List<string>();
        var equipment = new List<string>();
        foreach (var word in Normalize(name).Split(' '))
        {
            if (word.Length == 0)
                continue;
            if (!EquipmentWords.TryGetValue(word, out var eq))
                core.Add(Fold(word));
            else if (!equipment.Contains(eq))
                equipment.Add(eq);
        }
        return (core, equipment);
    }

    /// <summary>Key for exact comparison (<c>exactKey(words(name))</c>): core words in order, then equipment sorted.</summary>
    public static string Key(string name)
    {
        var (core, equipment) = Words(name);
        return KeyOf(core, equipment);
    }

    internal static string KeyOf(IEnumerable<string> core, IEnumerable<string> equipment) =>
        string.Join(' ', core.Concat(equipment.Order(StringComparer.Ordinal)));

    /// <summary>
    /// A Hevy title as a sheet name (front: <c>hevyTitleToSheetName</c>): <c>(X)</c> becomes <c> X </c> and the English
    /// equipment names become the canonical tokens (<c>smith machine</c> → <c>smith</c> first).
    /// </summary>
    public static string HevyTitleToSheetName(string title)
    {
        var name = Parenthesized().Replace(title, " $1 ");
        name = SmithMachine().Replace(name, "smith");
        name = Barbell().Replace(name, "barra");
        name = Dumbbell().Replace(name, "halter");
        name = Cable().Replace(name, "polia");
        return Machine().Replace(name, "maquina");
    }

    /// <summary>The exact key of a Hevy title: <see cref="HevyTitleToSheetName"/>, then <see cref="Key"/>.</summary>
    public static string FromHevyTitle(string title) => Key(HevyTitleToSheetName(title));
}
