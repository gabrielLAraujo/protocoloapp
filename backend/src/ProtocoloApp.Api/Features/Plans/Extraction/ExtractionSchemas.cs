using System.Text.Json.Nodes;

namespace ProtocoloApp.Api.Features.Plans.Extraction;

/// <summary>
/// JSON Schemas of the forced tools. Enum lists come from <see cref="PlanDocumentRules"/>, <see cref="MuscleGroup"/> and
/// <see cref="RotationDto"/>, the same sources the validators use; property names mirror the document DTOs (a unit test
/// compares them by reflection).
/// </summary>
internal static class ExtractionSchemas
{
    public const string ProtocolTool = "submit_protocol";
    public const string WorkoutTool = "submit_workout";

    public const string DatePattern = @"^\d{4}-\d{2}-\d{2}$";

    public static string ToolName(PlanKind kind) => kind == PlanKind.Protocol ? ProtocolTool : WorkoutTool;

    public static JsonObject For(PlanKind kind) => kind == PlanKind.Protocol ? Protocol() : Workout();

    public static JsonObject Protocol() => Envelope(ProtocolDocumentSchema(), includeNewExercises: false);

    public static JsonObject Workout() => Envelope(WorkoutDocumentSchema(), includeNewExercises: true);

    private static JsonObject Envelope(JsonObject document, bool includeNewExercises)
    {
        var properties = new JsonObject
        {
            ["document"] = document,
            ["lowConfidence"] = Array(Str(), "JSON paths (for example items[2].doseText) of values you are unsure about, including every inferred date."),
        };
        if (includeNewExercises)
        {
            properties["newExercises"] = Array(
                Obj(
                    new JsonObject
                    {
                        ["name"] = Str(),
                        ["group"] = Enum(EnumText.Values<MuscleGroup>(), "Suggested primary muscle group."),
                    },
                    "name", "group"),
                "Exercises of the document that match none of knownExercises.");
        }

        return Obj(properties, includeNewExercises ? new[] { "document", "lowConfidence", "newExercises" } : new[] { "document", "lowConfidence" });
    }

    private static JsonObject ProtocolDocumentSchema() => Obj(
        new JsonObject
        {
            ["phaseName"] = NullableStr(),
            ["updateDate"] = Date(),
            ["billingDate"] = Date(),
            ["meals"] = Array(Obj(
                new JsonObject
                {
                    ["key"] = Str("meal_1, meal_2, ..."),
                    ["label"] = Str(),
                    ["items"] = Array(Obj(
                        new JsonObject
                        {
                            ["food"] = Str(),
                            ["grams"] = Nullable("number"),
                            ["alternatives"] = Array(Str()),
                        },
                        "food", "alternatives")),
                    ["notes"] = NullableStr(),
                },
                "key", "label", "items")),
            ["items"] = Array(Obj(
                new JsonObject
                {
                    ["key"] = Str("it_1, it_2, ..."),
                    ["category"] = Enum(PlanDocumentRules.ItemCategories),
                    ["name"] = Str(),
                    ["doseText"] = NullableStr("Dose copied literally as text."),
                    ["timing"] = new JsonObject
                    {
                        ["anyOf"] = new JsonArray(
                            Enum(PlanDocumentRules.Timings),
                            new JsonObject { ["type"] = "string", ["pattern"] = "^with_meal:.+$" }),
                        ["description"] = "with_meal:<meal key> ties the item to a meal (for example with_meal:meal_3).",
                    },
                    ["schedule"] = Obj(
                        new JsonObject
                        {
                            ["type"] = Enum(PlanDocumentRules.ScheduleTypes),
                            ["days"] = Nullable(new JsonObject { ["type"] = "array", ["items"] = Enum(PlanDocumentRules.Weekdays) }),
                            ["n"] = Nullable("integer"),
                            ["anchor"] = Date(),
                        },
                        "type"),
                },
                "key", "category", "name", "timing", "schedule")),
            ["cardio"] = Nullable(Obj(
                new JsonObject
                {
                    ["sessionsPerWeek"] = Nullable("integer"),
                    ["daily"] = Nullable("boolean"),
                    ["durationMin"] = Nullable("integer"),
                    ["intensity"] = NullableStr(),
                    ["preferredTime"] = NullableStr(),
                })),
            ["guidelines"] = Array(Obj(
                new JsonObject
                {
                    ["kind"] = Enum(PlanDocumentRules.GuidelineKinds),
                    ["value"] = Nullable("number"),
                    ["text"] = NullableStr(),
                },
                "kind")),
            ["trainingSplitNote"] = NullableStr(),
        },
        "meals", "items", "guidelines");

    private static JsonObject WorkoutDocumentSchema() => Obj(
        new JsonObject
        {
            ["rotation"] = Obj(
                new JsonObject
                {
                    ["type"] = Enum([RotationDto.Sequence, RotationDto.FixedWeekdays]),
                    ["items"] = Nullable(new JsonObject { ["type"] = "array", ["items"] = Str() }, "Sequence of day keys; DESCANSO becomes \"off\"."),
                    ["map"] = Nullable(
                        Obj(
                            PlanDocumentRules.Weekdays.ToDictionary(d => d, _ => (JsonNode)Str()).ToJsonObject(),
                            PlanDocumentRules.Weekdays),
                        "For fixed_weekdays: mon..sun to a day key or \"off\"."),
                },
                "type"),
            ["days"] = Array(Obj(
                new JsonObject
                {
                    ["key"] = Str("A, B, C, ..."),
                    ["name"] = Str(),
                    ["notes"] = NullableStr(),
                    ["exercises"] = Array(Obj(
                        new JsonObject
                        {
                            ["key"] = Str("A1, A2, ..."),
                            ["exerciseId"] = Nullable(new JsonObject { ["type"] = "string", ["format"] = "uuid" }, "Id from knownExercises when the name matches."),
                            ["name"] = Str(),
                            ["sets"] = Array(Obj(
                                new JsonObject
                                {
                                    ["repsMin"] = new JsonObject { ["type"] = "integer", ["minimum"] = 0, ["maximum"] = 200 },
                                    ["repsMax"] = new JsonObject { ["type"] = "integer", ["minimum"] = 0, ["maximum"] = 200 },
                                    ["technique"] = NullableStr("For example \"drop\"."),
                                    ["drops"] = Nullable(new JsonObject { ["type"] = "integer", ["minimum"] = 0, ["maximum"] = 5 }, "Drop sub-sets after this set."),
                                    ["restPause"] = Nullable(new JsonObject { ["type"] = "integer", ["minimum"] = 0, ["maximum"] = 5 }, "Rest-pause sub-sets after this set."),
                                },
                                "repsMin", "repsMax")),
                            ["restSeconds"] = Nullable("integer"),
                            ["restSequence"] = Nullable(new JsonObject { ["type"] = "array", ["items"] = new JsonObject { ["type"] = "integer" } }, "Rest list for SST-style intervals, in seconds."),
                            ["technique"] = NullableStr("Free text of what is not in techniques."),
                            ["techniques"] = Nullable(Array(Technique()), "Structured techniques; null when there are none."),
                            ["supersetWith"] = NullableStr("Key of the exercise combined in a bi-set."),
                        },
                        "key", "name", "sets")),
                },
                "key", "name", "exercises")),
        },
        "rotation", "days");

    private static JsonObject ToJsonObject(this IEnumerable<KeyValuePair<string, JsonNode>> pairs)
    {
        var result = new JsonObject();
        foreach (var (key, value) in pairs)
            result[key] = value;
        return result;
    }

    private static JsonObject Technique() => Obj(
        new JsonObject
        {
            ["type"] = Enum(TechniqueTypes.All),
            ["count"] = Nullable(new JsonObject { ["type"] = "integer", ["minimum"] = 1, ["maximum"] = 5 }, "drop and rest_pause: how many (required, 1-5)."),
            ["sets"] = new JsonObject
            {
                ["description"] = "drop only (required): \"last\", \"all\" or the 0-based indexes of existing sets that get the drops.",
                ["anyOf"] = new JsonArray(
                    Enum(["last", "all"]),
                    Array(new JsonObject { ["type"] = "integer", ["minimum"] = 0 }),
                    new JsonObject { ["type"] = "null" }),
            },
            ["with"] = NullableStr("biset only: key of ANOTHER exercise of the same day (never itself or another day)."),
            ["rests"] = Nullable(new JsonObject { ["type"] = "array", ["minItems"] = 1, ["items"] = new JsonObject { ["type"] = "integer", ["minimum"] = 0, ["maximum"] = PlanDocumentRules.MaxRestSeconds } }, "sst only: at least one rest, in seconds (0-900)."),
            ["seconds"] = Nullable(new JsonObject { ["type"] = "integer", ["minimum"] = 1, ["maximum"] = 120 }, "Required for peak (1-10), isometric (1-120), zero_point (1-10) and eccentric (1-15): seconds. Never above these limits."),
            ["reps"] = new JsonObject
            {
                ["description"] = "partials (optional): one integer 1-30. cluster (required): the repetitions of each mini-set, 1-8 integers of 1-30, e.g. [3, 3, 3].",
                ["anyOf"] = new JsonArray(
                    new JsonObject { ["type"] = "integer", ["minimum"] = 1, ["maximum"] = 30 },
                    new JsonObject { ["type"] = "array", ["minItems"] = 1, ["maxItems"] = 8, ["items"] = new JsonObject { ["type"] = "integer", ["minimum"] = 1, ["maximum"] = 30 } },
                    new JsonObject { ["type"] = "null" }),
            },
            ["restSeconds"] = Nullable(new JsonObject { ["type"] = "integer", ["minimum"] = 5, ["maximum"] = 120 }, "cluster (required): pause between the mini-sets; fst7 (optional): rest between the 7 sets. Seconds, 5-120."),
            ["text"] = Nullable(new JsonObject { ["type"] = "string", ["pattern"] = TechniqueTypes.TempoPattern }, "tempo only (required): cadence such as \"3:2\" (up:down, seconds)."),
            ["percent"] = Nullable(new JsonObject { ["type"] = "integer", ["minimum"] = 1, ["maximum"] = 50 }, "drop only (optional): load reduction in percent."),
        },
        "type");

    private static JsonObject Obj(JsonObject properties, params string[] required) => new()
    {
        ["type"] = "object",
        ["properties"] = properties,
        ["required"] = new JsonArray(required.Select(r => (JsonNode)JsonValue.Create(r)!).ToArray()),
    };

    private static JsonObject Array(JsonNode items, string? description = null)
    {
        var node = new JsonObject { ["type"] = "array", ["items"] = items };
        if (description is not null)
            node["description"] = description;
        return node;
    }

    private static JsonObject Str(string? description = null)
    {
        var node = new JsonObject { ["type"] = "string" };
        if (description is not null)
            node["description"] = description;
        return node;
    }

    private static JsonObject NullableStr(string? description = null) => Nullable("string", description);

    private static JsonObject Nullable(string type, string? description = null) => Nullable(new JsonObject { ["type"] = type }, description);

    private static JsonObject Nullable(JsonObject schema, string? description = null)
    {
        var type = schema["type"]!.GetValue<string>();
        schema["type"] = new JsonArray(type, "null");
        if (description is not null)
            schema["description"] = description;
        return schema;
    }

    private static JsonObject Date() => new()
    {
        ["type"] = new JsonArray("string", "null"),
        ["pattern"] = DatePattern,
        ["description"] = "yyyy-MM-dd, or null when the PDF does not carry it.",
    };

    private static JsonObject Enum(IEnumerable<string> values, string? description = null)
    {
        var node = new JsonObject
        {
            ["type"] = "string",
            ["enum"] = new JsonArray(values.Select(v => (JsonNode)JsonValue.Create(v)!).ToArray()),
        };
        if (description is not null)
            node["description"] = description;
        return node;
    }
}
