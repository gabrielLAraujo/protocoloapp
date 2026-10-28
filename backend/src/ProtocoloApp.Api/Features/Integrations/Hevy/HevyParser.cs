using System.Text.Json;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>
/// Tolerant reading of Hevy's JSON: unknown fields are ignored, null or missing numbers are accepted, a malformed list item
/// is skipped and counted. An unexpected envelope (or a page where nothing is readable) is null, never an empty page.
/// The lists the sync pages through (workouts, events) must say their <c>page_count</c>: without it the run could not tell
/// the last page from a broken answer, so it is a format failure too.
/// </summary>
internal static class HevyParser
{
    /// <summary>Longer ids are not Hevy's (uuids and short template codes) and are treated as malformed.</summary>
    public const int MaxIdLength = 100;

    /// <summary>Entries read per list; anything beyond is skipped.</summary>
    public const int MaxItemsPerList = 200;

    public static HevyPage<HevyWorkout>? Workouts(JsonElement root) => Page(root, "workouts", TryWorkout, requirePageCount: true);

    /// <summary>Templates only feed a lookup: a missing <c>page_count</c> means this page is the last.</summary>
    public static HevyPage<HevyTemplate>? Templates(JsonElement root) => Page(root, "exercise_templates", TryTemplate, requirePageCount: false);

    public static HevyPage<HevyEvent>? Events(JsonElement root)
    {
        if (!TryList(root, "events", out var list))
            return null;

        var items = new List<HevyEvent>();
        var malformed = 0;
        var unknown = 0;
        foreach (var element in Limited(list, ref malformed))
        {
            switch (element.ValueKind == JsonValueKind.Object ? ReadString(element, "type") : null)
            {
                case HevyEvent.Updated:
                    if (element.TryGetProperty("workout", out var w) && TryWorkout(w) is { } workout)
                        items.Add(new HevyEvent(HevyEvent.Updated, workout, null, null));
                    else
                        malformed++;
                    break;
                case HevyEvent.Deleted:
                    if (ReadId(element, "id") is { } id)
                        items.Add(new HevyEvent(HevyEvent.Deleted, null, id, ReadDate(element, "deleted_at")));
                    else
                        malformed++;
                    break;
                case null when element.ValueKind != JsonValueKind.Object:
                    malformed++;
                    break;
                default:
                    // A new event type: skipped, but it does not mean the format broke.
                    unknown++;
                    break;
            }
        }

        if (items.Count == 0 && malformed > 0)
            return null;

        // A page of only unknown event types is an empty page, not the end: the run keeps going to page_count.
        var (page, pageCount) = ReadPaging(root);
        if (pageCount is not { } count)
            return null;
        return new HevyPage<HevyEvent>(items, page, count, malformed + unknown);
    }

    /// <summary>A single workout, bare or wrapped in <c>{ "workout": ... }</c>.</summary>
    public static HevyWorkout? Workout(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
            return null;
        if (root.TryGetProperty("workout", out var wrapped) && wrapped.ValueKind == JsonValueKind.Object)
            return TryWorkout(wrapped);
        return TryWorkout(root);
    }

    private static HevyPage<T>? Page<T>(JsonElement root, string listName, Func<JsonElement, T?> read, bool requirePageCount) where T : class
    {
        if (!TryList(root, listName, out var list))
            return null;

        var items = new List<T>();
        var skipped = 0;
        foreach (var element in Limited(list, ref skipped))
        {
            if (read(element) is { } item)
                items.Add(item);
            else
                skipped++;
        }

        // Entries but none readable: the format changed. Not an empty page, so it must not look like a finished sync.
        if (items.Count == 0 && skipped > 0)
            return null;

        var (page, pageCount) = ReadPaging(root);
        if (pageCount is null && requirePageCount)
            return null;
        return new HevyPage<T>(items, page, pageCount ?? page, skipped);
    }

    private static bool TryList(JsonElement root, string name, out JsonElement list)
    {
        list = default;
        return root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty(name, out list)
            && list.ValueKind == JsonValueKind.Array;
    }

    private static List<JsonElement> Limited(JsonElement list, ref int skipped)
    {
        var length = list.GetArrayLength();
        if (length > MaxItemsPerList)
            skipped += length - MaxItemsPerList;
        return list.EnumerateArray().Take(MaxItemsPerList).ToList();
    }

    /// <summary>The page (1 when absent) and <c>page_count</c> (null when absent or invalid).</summary>
    private static (int Page, int? PageCount) ReadPaging(JsonElement root)
    {
        var page = ReadInt(root, "page") is { } p && p > 0 ? p : 1;
        int? count = ReadInt(root, "page_count") is { } c && c >= 0 ? c : null;
        return (page, count);
    }

    private static HevyWorkout? TryWorkout(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return null;

        var id = ReadId(element, "id");
        var start = ReadDate(element, "start_time");
        if (id is null || start is null)
            return null;

        var exercises = new List<HevyExercise>();
        if (element.TryGetProperty("exercises", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            foreach (var e in list.EnumerateArray().Take(MaxItemsPerList))
            {
                if (TryExercise(e) is { } exercise)
                    exercises.Add(exercise);
            }
        }

        return new HevyWorkout(
            id,
            ReadString(element, "title")?.Trim() ?? "",
            ReadString(element, "description"),
            start.Value,
            ReadDate(element, "end_time"),
            ReadDate(element, "updated_at") ?? ReadDate(element, "created_at") ?? start.Value,
            exercises);
    }

    private static HevyExercise? TryExercise(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return null;

        var templateId = ReadId(element, "exercise_template_id");
        if (templateId is null)
            return null;

        var sets = new List<HevySet>();
        if (element.TryGetProperty("sets", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            var position = 0;
            foreach (var s in list.EnumerateArray().Take(MaxItemsPerList))
            {
                if (s.ValueKind == JsonValueKind.Object)
                {
                    sets.Add(new HevySet(
                        ReadInt(s, "index") ?? position,
                        ReadString(s, "type") ?? "normal",
                        ReadDecimal(s, "weight_kg"),
                        ReadInt(s, "reps"),
                        ReadDecimal(s, "distance_meters"),
                        ReadInt(s, "duration_seconds"),
                        ReadDecimal(s, "rpe")));
                }

                position++;
            }
        }

        return new HevyExercise(
            ReadString(element, "title")?.Trim() ?? "",
            templateId,
            ReadInt(element, "superset_id"),
            ReadString(element, "notes"),
            sets);
    }

    private static HevyTemplate? TryTemplate(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return null;

        var id = ReadId(element, "id");
        var title = ReadString(element, "title")?.Trim();
        if (id is null || string.IsNullOrEmpty(title))
            return null;

        return new HevyTemplate(id, title, ReadString(element, "primary_muscle_group"));
    }

    private static string? ReadString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static string? ReadId(JsonElement element, string property)
    {
        var id = ReadString(element, property)?.Trim();
        return string.IsNullOrEmpty(id) || id.Length > MaxIdLength ? null : id;
    }

    private static DateTimeOffset? ReadDate(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String && value.TryGetDateTimeOffset(out var date)
            ? date
            : null;

    private static decimal? ReadDecimal(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number)
            ? number
            : null;

    /// <summary>Integral numbers only (<c>8.0</c> is 8, <c>7.5</c> is null).</summary>
    private static int? ReadInt(JsonElement element, string property)
    {
        if (ReadDecimal(element, property) is not { } number || number != decimal.Truncate(number)
            || number < int.MinValue || number > int.MaxValue)
        {
            return null;
        }

        return (int)number;
    }
}
