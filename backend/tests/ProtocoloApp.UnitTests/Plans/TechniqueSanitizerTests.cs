using System.Text.Json;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Plans.Extraction;

namespace ProtocoloApp.UnitTests.Plans;

public sealed class TechniqueSanitizerTests
{
    private static IReadOnlyList<TechniqueDto> Sanitize(string techniques)
    {
        var json = $$"""
            { "rotation": { "type": "sequence", "items": ["A"] },
              "days": [ { "key": "A", "name": "Dia fictício", "exercises": [
                { "key": "A1", "name": "Movimento alfa", "sets": [ { "repsMin": 8, "repsMax": 10 }, { "repsMin": 8, "repsMax": 10 } ], "techniques": {{techniques}} } ] } ] }
            """;
        var doc = TechniqueSanitizer.Sanitize(PlanDocuments.Deserialize<WorkoutDocument>(json)!);
        Assert.Empty(new WorkoutDocumentValidator().Validate(doc).Errors);
        return doc.Days[0].Exercises[0].Techniques!;
    }

    [Fact]
    public void New_technique_types_are_clamped_into_their_ranges()
    {
        var techniques = Sanitize("""
            [ { "type": "eccentric", "seconds": 40 }, { "type": "eccentric", "seconds": 0 },
              { "type": "cluster", "reps": [0, 3, 50, 2, 2, 2, 2, 2, 2, 2], "restSeconds": 300 },
              { "type": "fst7", "restSeconds": 2 }, { "type": "fst7" },
              { "type": "tempo", "text": "3 : 2" }, { "type": "to_failure" },
              { "type": "drop", "count": 1, "sets": "last", "percent": 80 }, { "type": "drop", "count": 1, "sets": "last", "percent": 25 } ]
            """);

        Assert.Equal(["eccentric", "eccentric", "cluster", "fst7", "fst7", "tempo", "to_failure", "drop", "drop"], techniques.Select(t => t.Type));
        Assert.Equal(15, techniques[0].Seconds);
        Assert.Equal(1, techniques[1].Seconds);
        Assert.Equal([1, 3, 30, 2, 2, 2, 2, 2], TechniqueValues.AsIntList(techniques[2].Reps));
        Assert.Equal(120, techniques[2].RestSeconds);
        Assert.Equal(5, techniques[3].RestSeconds);
        Assert.Null(techniques[4].RestSeconds);
        Assert.Equal("3:2", techniques[5].Text);
        Assert.Null(techniques[7].Percent);
        Assert.Equal(25, techniques[8].Percent);
    }

    [Fact]
    public void New_technique_types_that_cannot_be_repaired_are_dropped()
    {
        var techniques = Sanitize("""
            [ { "type": "eccentric" }, { "type": "cluster", "reps": [3, 3] }, { "type": "cluster", "reps": 3, "restSeconds": 20 },
              { "type": "cluster", "reps": [], "restSeconds": 20 }, { "type": "tempo", "text": "devagar" }, { "type": "tempo" },
              { "type": "peak", "seconds": 2 } ]
            """);

        Assert.Equal(["peak"], techniques.Select(t => t.Type));
    }

    [Fact]
    public void Partials_reps_must_be_a_single_integer_in_range()
    {
        var techniques = Sanitize("""[ { "type": "partials", "reps": [3, 3] }, { "type": "partials", "reps": 40 }, { "type": "partials", "reps": 6 } ]""");

        Assert.False(TechniqueValues.IsPresent(techniques[0].Reps));
        Assert.False(TechniqueValues.IsPresent(techniques[1].Reps));
        Assert.Equal(6, TechniqueValues.AsInt(techniques[2].Reps));
        Assert.Equal(JsonValueKind.Number, techniques[2].Reps!.Value.ValueKind);
    }
}
