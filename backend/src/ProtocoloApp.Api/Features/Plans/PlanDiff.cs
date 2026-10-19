using System.Text.Json;

namespace ProtocoloApp.Api.Features.Plans;

public sealed record PlanChange(string Path, JsonElement? Before, JsonElement? After);

/// <summary>
/// Differences between the active document and a draft. Added and removed are paths of keyed entities
/// (<c>days[a].exercises[bench]</c>); changed lists every other value that differs, with before and after.
/// </summary>
public sealed record PlanDiffDto(IReadOnlyList<string> Added, IReadOnlyList<string> Removed, IReadOnlyList<PlanChange> Changed);

/// <summary>
/// Compares two plan documents by key: arrays whose elements all have a string <c>key</c> (<c>meals</c>, <c>items</c>, <c>days</c>,
/// <c>days[].exercises</c>) are matched by it; objects are compared property by property; anything else (scalars, arrays
/// without keys such as <c>sets</c>) as a whole value.
/// </summary>
public static class PlanDiff
{
    private static readonly JsonElement EmptyObject = JsonDocument.Parse("{}").RootElement;

    /// <summary>A missing active document counts as an empty one: every keyed entity of the draft is then added.</summary>
    public static PlanDiffDto Compute(JsonElement? active, JsonElement draft)
    {
        var added = new List<string>();
        var removed = new List<string>();
        var changed = new List<PlanChange>();
        Walk("", active is { ValueKind: JsonValueKind.Object } ? active : EmptyObject, draft, added, removed, changed);
        return new PlanDiffDto(added, removed, changed);
    }

    private static void Walk(string path, JsonElement? before, JsonElement? after, List<string> added, List<string> removed, List<PlanChange> changed)
    {
        before = Normalize(before);
        after = Normalize(after);

        if (before is { ValueKind: JsonValueKind.Object } && after is { ValueKind: JsonValueKind.Object })
        {
            foreach (var name in PropertyNames(before, after))
                Walk(Join(path, name), Property(before, name), Property(after, name), added, removed, changed);
            return;
        }

        if (IsKeyed(before) && IsKeyed(after))
        {
            var beforeByKey = ByKey(before);
            var afterByKey = ByKey(after);
            foreach (var (key, element) in afterByKey)
            {
                if (!beforeByKey.ContainsKey(key))
                    added.Add($"{path}[{key}]");
                else
                    Walk($"{path}[{key}]", beforeByKey[key], element, added, removed, changed);
            }

            removed.AddRange(beforeByKey.Keys.Where(key => !afterByKey.ContainsKey(key)).Select(key => $"{path}[{key}]"));
            return;
        }

        if (!DeepEquals(before, after))
            AddChange(path, before, after, changed);
    }

    private static void AddChange(string path, JsonElement? before, JsonElement? after, List<PlanChange> changed) =>
        changed.Add(new PlanChange(path, before?.Clone(), after?.Clone()));

    /// <summary>A JSON null and a missing value are the same thing; a missing side next to a keyed array is an empty array.</summary>
    private static JsonElement? Normalize(JsonElement? value) => value is { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } ? null : value;

    private static bool IsKeyed(JsonElement? value) =>
        value is null || (value.Value.ValueKind == JsonValueKind.Array && value.Value.EnumerateArray().All(HasStringKey));

    private static bool HasStringKey(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty("key", out var key) && key.ValueKind == JsonValueKind.String;

    private static Dictionary<string, JsonElement> ByKey(JsonElement? array)
    {
        var map = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        if (array is { } value)
        {
            foreach (var element in value.EnumerateArray())
                map.TryAdd(element.GetProperty("key").GetString()!, element);
        }

        return map;
    }

    private static IEnumerable<string> PropertyNames(JsonElement? before, JsonElement? after)
    {
        var names = new List<string>();
        foreach (var side in new[] { before, after })
        {
            if (side is null)
                continue;
            foreach (var property in side.Value.EnumerateObject().Where(p => !names.Contains(p.Name)))
                names.Add(property.Name);
        }

        return names;
    }

    private static JsonElement? Property(JsonElement? obj, string name) =>
        obj is { } value && value.TryGetProperty(name, out var property) ? property : null;

    private static string Join(string path, string name) => path.Length == 0 ? name : $"{path}.{name}";

    private static bool DeepEquals(JsonElement? x, JsonElement? y)
    {
        if (x is null || y is null)
            return x is null && y is null;

        var (a, b) = (x.Value, y.Value);
        if (a.ValueKind != b.ValueKind)
            return false;

        switch (a.ValueKind)
        {
            case JsonValueKind.Object:
                var left = a.EnumerateObject().ToList();
                if (left.Count != b.EnumerateObject().Count())
                    return false;
                return left.All(p => b.TryGetProperty(p.Name, out var other) && DeepEquals(p.Value, other));
            case JsonValueKind.Array:
                var items = a.EnumerateArray().ToList();
                var others = b.EnumerateArray().ToList();
                return items.Count == others.Count && items.Zip(others).All(pair => DeepEquals(pair.First, pair.Second));
            case JsonValueKind.String:
                return string.Equals(a.GetString(), b.GetString(), StringComparison.Ordinal);
            case JsonValueKind.Number:
                return a.TryGetDecimal(out var m) && b.TryGetDecimal(out var n) ? m == n : a.GetRawText() == b.GetRawText();
            default:
                return true; // true/true, false/false
        }
    }
}
