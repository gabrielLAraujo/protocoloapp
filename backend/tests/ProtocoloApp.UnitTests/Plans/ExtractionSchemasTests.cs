using System.Text.Json;
using System.Text.Json.Nodes;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Plans.Extraction;

namespace ProtocoloApp.UnitTests.Plans;

public sealed class ExtractionSchemasTests
{
    private static JsonElement Document(JsonObject schema) => JsonSerializer.SerializeToElement(schema).GetProperty("properties").GetProperty("document");

    private static string[] Enum(JsonElement node) => node.GetProperty("enum").EnumerateArray().Select(e => e.GetString()!).ToArray();

    private static string Camel(string name) => char.ToLowerInvariant(name[0]) + name[1..];

    private static void AssertMirrors(JsonElement schema, Type clr, string path)
    {
        clr = Nullable.GetUnderlyingType(clr) ?? clr;
        var types = schema.TryGetProperty("type", out var t)
            ? (t.ValueKind == JsonValueKind.Array ? t.EnumerateArray().Select(e => e.GetString()!) : [t.GetString()!]).ToArray()
            : [];

        if (types.Contains("object"))
        {
            if (clr.IsGenericType && clr.GetGenericTypeDefinition() == typeof(IReadOnlyDictionary<,>))
                return;

            var schemaProps = schema.GetProperty("properties").EnumerateObject().Select(p => p.Name).Order().ToArray();
            var clrProps = clr.GetProperties().Select(p => Camel(p.Name)).Order().ToArray();
            Assert.True(clrProps.SequenceEqual(schemaProps), $"{path}: schema [{string.Join(",", schemaProps)}] vs {clr.Name} [{string.Join(",", clrProps)}]");

            if (schema.TryGetProperty("required", out var required))
                Assert.All(required.EnumerateArray().Select(r => r.GetString()!), r => Assert.Contains(r, schemaProps));

            foreach (var property in schema.GetProperty("properties").EnumerateObject())
            {
                var clrProperty = clr.GetProperties().Single(p => Camel(p.Name) == property.Name);
                AssertMirrors(property.Value, clrProperty.PropertyType, $"{path}.{property.Name}");
            }
        }
        else if (types.Contains("array"))
        {
            var item = clr.GetGenericArguments()[0];
            AssertMirrors(schema.GetProperty("items"), item, path + "[]");
        }
    }

    [Fact]
    public void Protocol_schema_properties_mirror_the_document_dtos()
    {
        AssertMirrors(Document(ExtractionSchemas.Protocol()), typeof(ProtocolDocument), "document");
    }

    [Fact]
    public void Workout_schema_properties_mirror_the_document_dtos()
    {
        AssertMirrors(Document(ExtractionSchemas.Workout()), typeof(WorkoutDocument), "document");
    }

    [Fact]
    public void Enums_come_from_the_validator_rules_and_the_domain_enums()
    {
        var protocol = Document(ExtractionSchemas.Protocol());
        var item = protocol.GetProperty("properties").GetProperty("items").GetProperty("items").GetProperty("properties");
        Assert.Equal(PlanDocumentRules.ItemCategories, Enum(item.GetProperty("category")));
        Assert.Equal(PlanDocumentRules.Timings, Enum(item.GetProperty("timing").GetProperty("anyOf")[0]));
        Assert.Equal(PlanDocumentRules.ScheduleTypes, Enum(item.GetProperty("schedule").GetProperty("properties").GetProperty("type")));
        Assert.Equal(PlanDocumentRules.Weekdays, item.GetProperty("schedule").GetProperty("properties").GetProperty("days").GetProperty("items").GetProperty("enum").EnumerateArray().Select(e => e.GetString()).ToArray());
        var guideline = protocol.GetProperty("properties").GetProperty("guidelines").GetProperty("items").GetProperty("properties");
        Assert.Equal(PlanDocumentRules.GuidelineKinds, Enum(guideline.GetProperty("kind")));

        var workout = Document(ExtractionSchemas.Workout());
        Assert.Equal(new[] { RotationDto.Sequence, RotationDto.FixedWeekdays }, Enum(workout.GetProperty("properties").GetProperty("rotation").GetProperty("properties").GetProperty("type")));

        var newExercises = JsonSerializer.SerializeToElement(ExtractionSchemas.Workout()).GetProperty("properties").GetProperty("newExercises");
        Assert.Equal(EnumText.Values<MuscleGroup>(), Enum(newExercises.GetProperty("items").GetProperty("properties").GetProperty("group")));
    }

    [Fact]
    public void Every_schema_enum_value_passes_the_protocol_validator()
    {
        var item = Document(ExtractionSchemas.Protocol()).GetProperty("properties").GetProperty("items").GetProperty("items").GetProperty("properties");
        var validator = new ProtocolDocumentValidator();
        var categories = Enum(item.GetProperty("category"));
        var timings = Enum(item.GetProperty("timing").GetProperty("anyOf")[0]).Append("with_meal:meal_2");
        var schedules = Enum(item.GetProperty("schedule").GetProperty("properties").GetProperty("type"));

        var items = new List<ProtocolItemDto>();
        foreach (var category in categories)
        {
            foreach (var timing in timings)
            {
                foreach (var type in schedules)
                {
                    items.Add(new ProtocolItemDto
                    {
                        Key = $"it_{items.Count + 1}",
                        Category = category,
                        Name = "Item ficticio",
                        Timing = timing,
                        Schedule = new ScheduleDto { Type = type, Days = type == "weekdays" ? ["mon"] : null, N = type == "every_n_days" ? 2 : null },
                    });
                }
            }
        }

        var result = validator.Validate(new ProtocolDocument { Items = items });
        Assert.True(result.IsValid, string.Join("; ", result.Errors.Select(e => e.PropertyName)));
    }

    [Theory]
    [InlineData("anthropic-protocol-response.json", PlanKind.Protocol)]
    [InlineData("anthropic-workout-response.json", PlanKind.Workout)]
    public void Schema_shaped_fixtures_read_through_TryRead_and_validate(string fixture, PlanKind kind)
    {
        using var reply = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", fixture)));
        var input = reply.RootElement.GetProperty("content").EnumerateArray().Single(b => b.GetProperty("type").GetString() == "tool_use").GetProperty("input");
        Assert.Equal(ExtractionSchemas.ToolName(kind), reply.RootElement.GetProperty("content").EnumerateArray().Single(b => b.GetProperty("type").GetString() == "tool_use").GetProperty("name").GetString());

        var document = input.GetProperty("document");
        if (kind == PlanKind.Protocol)
        {
            Assert.True(PlanDocuments.TryRead<ProtocolDocument>(document, out var protocol, out var errors), string.Join(",", errors));
            Assert.True(new ProtocolDocumentValidator().Validate(protocol!).IsValid);
        }
        else
        {
            Assert.True(PlanDocuments.TryRead<WorkoutDocument>(document, out var workout, out var errors), string.Join(",", errors));
            Assert.True(new WorkoutDocumentValidator().Validate(workout!).IsValid);
        }
    }

    [Fact]
    public void Tool_names_follow_the_kind()
    {
        Assert.Equal("submit_protocol", ExtractionSchemas.ToolName(PlanKind.Protocol));
        Assert.Equal("submit_workout", ExtractionSchemas.ToolName(PlanKind.Workout));
    }
}
