using System.Text.Json;
using ProtocoloApp.Api.Features.Plans;

namespace ProtocoloApp.UnitTests.Plans;

public sealed class TechniqueDocumentTests
{
    private static readonly WorkoutDocumentValidator Validator = new();

    private static string Doc(string setExtra, string techniques) => $$"""
        {
          "rotation": { "type": "sequence", "items": ["A"] },
          "days": [
            { "key": "A", "name": "Dia fictício", "exercises": [
              { "key": "A1", "name": "Movimento alfa",
                "sets": [ { "repsMin": 8, "repsMax": 10 }, { "repsMin": 8, "repsMax": 10{{setExtra}} } ],
                "techniques": {{techniques}} },
              { "key": "A2", "name": "Movimento beta", "sets": [ { "repsMin": 8, "repsMax": 10 } ] } ] }
          ]
        }
        """;

    private static List<string> Errors(string json)
    {
        Assert.True(PlanDocuments.TryRead<WorkoutDocument>(JsonDocument.Parse(json).RootElement, out var doc, out var readErrors), string.Join(",", readErrors));
        return Validator.Validate(doc!).Errors.Select(e => e.PropertyName).Distinct().ToList();
    }

    private const string AllTechniques = """
        [ { "type": "drop", "count": 2, "sets": "last" }, { "type": "drop", "count": 1, "sets": [0, 1] },
          { "type": "rest_pause", "count": 1 }, { "type": "biset", "with": "A2" }, { "type": "sst", "rests": [40, 20, 10] },
          { "type": "peak", "seconds": 3 }, { "type": "isometric", "seconds": 20 }, { "type": "partials" },
          { "type": "partials", "reps": 6 }, { "type": "zero_point", "seconds": 2 },
          { "type": "progressive_load" }, { "type": "stretch_interval" },
          { "type": "drop", "count": 1, "sets": "last", "percent": 20 }, { "type": "eccentric", "seconds": 15 },
          { "type": "cluster", "reps": [3, 3, 3], "restSeconds": 20 }, { "type": "fst7" }, { "type": "fst7", "restSeconds": 30 },
          { "type": "tempo", "text": "3:2" }, { "type": "tempo", "text": "2:1:2" }, { "type": "to_failure" },
          { "type": "partials", "reps": null } ]
        """;

    [Fact]
    public void Every_technique_type_and_the_set_fields_validate_and_round_trip()
    {
        var json = Doc(", \"drops\": 2, \"restPause\": 1", AllTechniques);
        Assert.Empty(Errors(json));

        var doc = PlanDocuments.Deserialize<WorkoutDocument>(json)!;
        var exercise = doc.Days[0].Exercises[0];
        Assert.Equal(21, exercise.Techniques!.Count);
        Assert.Equal((2, 1), (exercise.Sets[1].Drops, exercise.Sets[1].RestPause));

        var again = PlanDocuments.Deserialize<WorkoutDocument>(PlanDocuments.Serialize(doc))!;
        Assert.Equal(exercise.Techniques.Select(t => t.Type), again.Days[0].Exercises[0].Techniques!.Select(t => t.Type));
        Assert.Equal("A2", again.Days[0].Exercises[0].Techniques![3].With);
        Assert.Equal([40, 20, 10], again.Days[0].Exercises[0].Techniques![4].Rests);
        Assert.Equal("last", again.Days[0].Exercises[0].Techniques![0].Sets!.Value.GetString());
        Assert.Equal(2, again.Days[0].Exercises[0].Sets[1].Drops);

        var techniques = again.Days[0].Exercises[0].Techniques!;
        Assert.Equal(6, TechniqueValues.AsInt(techniques[8].Reps));
        Assert.Equal(20, techniques[12].Percent);
        Assert.Equal(15, techniques[13].Seconds);
        Assert.Equal([3, 3, 3], TechniqueValues.AsIntList(techniques[14].Reps));
        Assert.Equal(20, techniques[14].RestSeconds);
        Assert.Null(techniques[15].RestSeconds);
        Assert.Equal(30, techniques[16].RestSeconds);
        Assert.Equal("2:1:2", techniques[18].Text);
        Assert.Equal(TechniqueTypes.ToFailure, techniques[19].Type);
        Assert.False(TechniqueValues.IsPresent(techniques[20].Reps));
    }

    [Fact]
    public void Documents_without_the_new_fields_still_validate()
    {
        const string old = """
            { "rotation": { "type": "sequence", "items": ["A"] },
              "days": [ { "key": "A", "name": "Dia", "exercises": [
                { "key": "A1", "name": "Movimento", "sets": [ { "repsMin": 8, "repsMax": 10, "technique": "drop" } ], "technique": "texto", "supersetWith": null } ] } ] }
            """;

        Assert.Empty(Errors(old));
        Assert.Null(PlanDocuments.Deserialize<WorkoutDocument>(old)!.Days[0].Exercises[0].Techniques);
    }

    [Theory]
    [InlineData("""[ { "type": "laser" } ]""", "days[0].exercises[0].techniques[0].type")]
    [InlineData("""[ { "type": "drop", "count": 6, "sets": "last" } ]""", "days[0].exercises[0].techniques[0].count")]
    [InlineData("""[ { "type": "drop", "count": 0, "sets": "all" } ]""", "days[0].exercises[0].techniques[0].count")]
    [InlineData("""[ { "type": "drop", "count": 1, "sets": "first" } ]""", "days[0].exercises[0].techniques[0].sets")]
    [InlineData("""[ { "type": "drop", "count": 1, "sets": [5] } ]""", "days[0].exercises[0].techniques[0].sets")]
    [InlineData("""[ { "type": "drop", "count": 1 } ]""", "days[0].exercises[0].techniques[0].sets")]
    [InlineData("""[ { "type": "rest_pause", "count": 6 } ]""", "days[0].exercises[0].techniques[0].count")]
    [InlineData("""[ { "type": "biset", "with": "Z9" } ]""", "days[0].exercises[0].techniques[0].with")]
    [InlineData("""[ { "type": "biset", "with": "A1" } ]""", "days[0].exercises[0].techniques[0].with")]
    [InlineData("""[ { "type": "sst", "rests": [] } ]""", "days[0].exercises[0].techniques[0].rests")]
    [InlineData("""[ { "type": "peak", "seconds": 11 } ]""", "days[0].exercises[0].techniques[0].seconds")]
    [InlineData("""[ { "type": "isometric", "seconds": 121 } ]""", "days[0].exercises[0].techniques[0].seconds")]
    [InlineData("""[ { "type": "zero_point", "seconds": 0 } ]""", "days[0].exercises[0].techniques[0].seconds")]
    [InlineData("""[ { "type": "partials", "reps": 31 } ]""", "days[0].exercises[0].techniques[0].reps")]
    [InlineData("""[ { "type": "partials", "reps": [3, 3] } ]""", "days[0].exercises[0].techniques[0].reps")]
    [InlineData("""[ { "type": "drop", "count": 1, "sets": "last", "percent": 51 } ]""", "days[0].exercises[0].techniques[0].percent")]
    [InlineData("""[ { "type": "drop", "count": 1, "sets": "last", "percent": 0 } ]""", "days[0].exercises[0].techniques[0].percent")]
    [InlineData("""[ { "type": "eccentric", "seconds": 16 } ]""", "days[0].exercises[0].techniques[0].seconds")]
    [InlineData("""[ { "type": "eccentric" } ]""", "days[0].exercises[0].techniques[0].seconds")]
    [InlineData("""[ { "type": "cluster", "reps": [], "restSeconds": 20 } ]""", "days[0].exercises[0].techniques[0].reps")]
    [InlineData("""[ { "type": "cluster", "reps": [1, 1, 1, 1, 1, 1, 1, 1, 1], "restSeconds": 20 } ]""", "days[0].exercises[0].techniques[0].reps")]
    [InlineData("""[ { "type": "cluster", "reps": [31], "restSeconds": 20 } ]""", "days[0].exercises[0].techniques[0].reps")]
    [InlineData("""[ { "type": "cluster", "reps": 3, "restSeconds": 20 } ]""", "days[0].exercises[0].techniques[0].reps")]
    [InlineData("""[ { "type": "cluster", "reps": [3, 3], "restSeconds": 4 } ]""", "days[0].exercises[0].techniques[0].restSeconds")]
    [InlineData("""[ { "type": "cluster", "reps": [3, 3] } ]""", "days[0].exercises[0].techniques[0].restSeconds")]
    [InlineData("""[ { "type": "fst7", "restSeconds": 121 } ]""", "days[0].exercises[0].techniques[0].restSeconds")]
    [InlineData("""[ { "type": "tempo", "text": "3-2" } ]""", "days[0].exercises[0].techniques[0].text")]
    [InlineData("""[ { "type": "tempo", "text": "123:2" } ]""", "days[0].exercises[0].techniques[0].text")]
    [InlineData("""[ { "type": "tempo" } ]""", "days[0].exercises[0].techniques[0].text")]
    public void Technique_out_of_range_or_unknown_is_a_field_keyed_error(string techniques, string path)
    {
        Assert.Contains(path, Errors(Doc("", techniques)));
    }

    [Fact]
    public void Biset_pointing_to_an_exercise_of_another_day_is_an_error()
    {
        const string json = """
            { "rotation": { "type": "sequence", "items": ["A", "B"] },
              "days": [
                { "key": "A", "name": "Dia um", "exercises": [ { "key": "A1", "name": "Movimento alfa", "sets": [ { "repsMin": 8, "repsMax": 10 } ], "techniques": [ { "type": "biset", "with": "B1" } ] } ] },
                { "key": "B", "name": "Dia dois", "exercises": [ { "key": "B1", "name": "Movimento beta", "sets": [ { "repsMin": 8, "repsMax": 10 } ] } ] } ] }
            """;

        Assert.Contains("days[0].exercises[0].techniques[0].with", Errors(json));
    }

    [Theory]
    [InlineData(", \"drops\": 6", "days[0].exercises[0].sets[1].drops")]
    [InlineData(", \"drops\": -1", "days[0].exercises[0].sets[1].drops")]
    [InlineData(", \"restPause\": 6", "days[0].exercises[0].sets[1].restPause")]
    public void Set_sub_sets_outside_0_to_5_are_errors(string extra, string path)
    {
        Assert.Contains(path, Errors(Doc(extra, "[]")));
    }

    [Fact]
    public void Set_sub_sets_at_the_limits_are_valid()
    {
        Assert.Empty(Errors(Doc(", \"drops\": 5, \"restPause\": 0", "null")));
    }
}
