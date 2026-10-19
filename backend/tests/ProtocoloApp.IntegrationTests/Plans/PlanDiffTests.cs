using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Plans;

[Collection("api")]
public sealed class PlanDiffTests(ApiFactory factory)
{
    private const string Active = """
        {"rotation":{"type":"sequence","items":["a"]},"days":[{"key":"a","name":"A","exercises":[
          {"key":"bench","name":"Supino","sets":[{"repsMin":8,"repsMax":10},{"repsMin":8,"repsMax":10}],"restSeconds":90},
          {"key":"fly","name":"Crucifixo","sets":[{"repsMin":10,"repsMax":12}]}]}]}
        """;

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void Detects_added_and_removed_exercises_and_changed_sets()
    {
        const string Draft = """
            {"rotation":{"type":"sequence","items":["a"]},"days":[{"key":"a","name":"A","exercises":[
              {"key":"bench","name":"Supino","sets":[{"repsMin":6,"repsMax":8},{"repsMin":6,"repsMax":8},{"repsMin":6,"repsMax":8}],"restSeconds":90},
              {"key":"row","name":"Remada","sets":[{"repsMin":8,"repsMax":12}]}]}]}
            """;

        var diff = PlanDiff.Compute(Parse(Active), Parse(Draft));

        Assert.Equal(["days[a].exercises[row]"], diff.Added);
        Assert.Equal(["days[a].exercises[fly]"], diff.Removed);
        var change = Assert.Single(diff.Changed);
        Assert.Equal("days[a].exercises[bench].sets", change.Path);
        Assert.Equal(2, change.Before!.Value.GetArrayLength());
        Assert.Equal(3, change.After!.Value.GetArrayLength());
    }

    [Fact]
    public void Detects_added_and_removed_days_and_changed_scalars()
    {
        const string Draft = """
            {"rotation":{"type":"sequence","items":["a","b"]},"days":[{"key":"b","name":"B","exercises":[]},{"key":"a","name":"Treino A","exercises":[
              {"key":"bench","name":"Supino","sets":[{"repsMin":8,"repsMax":10},{"repsMin":8,"repsMax":10}],"restSeconds":120},
              {"key":"fly","name":"Crucifixo","sets":[{"repsMin":10,"repsMax":12}]}]}]}
            """;

        var diff = PlanDiff.Compute(Parse(Active), Parse(Draft));

        Assert.Equal(["days[b]"], diff.Added);
        Assert.Empty(diff.Removed);
        var paths = diff.Changed.Select(c => c.Path).Order(StringComparer.Ordinal).ToList();
        Assert.Equal(["days[a].exercises[bench].restSeconds", "days[a].name", "rotation.items"], paths);
        Assert.Equal(90, diff.Changed.Single(c => c.Path.EndsWith("restSeconds", StringComparison.Ordinal)).Before!.Value.GetInt32());
    }

    [Fact]
    public void Protocol_meals_and_items_are_matched_by_key()
    {
        const string Before = """{"meals":[{"key":"m1","label":"R1","items":[]}],"items":[{"key":"cr","name":"Creatina","schedule":{"type":"daily"}}]}""";
        const string After = """{"meals":[{"key":"m1","label":"R1","items":[]},{"key":"m2","label":"R2","items":[]}],"items":[{"key":"cr","name":"Creatina","schedule":{"type":"weekdays","days":["mon"]}}]}""";

        var diff = PlanDiff.Compute(Parse(Before), Parse(After));

        Assert.Equal(["meals[m2]"], diff.Added);
        Assert.Equal(["items[cr].schedule.days", "items[cr].schedule.type"], diff.Changed.Select(c => c.Path).Order(StringComparer.Ordinal).ToList());
    }

    [Fact]
    public void Identical_documents_and_a_missing_active_document()
    {
        var same = PlanDiff.Compute(Parse(Active), Parse(Active));
        Assert.Empty(same.Added);
        Assert.Empty(same.Removed);
        Assert.Empty(same.Changed);

        var first = PlanDiff.Compute(null, Parse(Active));
        Assert.Equal(["days[a]"], first.Added);
    }

    [Fact]
    public async Task Get_of_a_draft_includes_the_diff_against_the_active_plan()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var none = await api.ImportDraftAsync();
        Assert.Null((await api.GetAsync(none.Id)).Diff);
        await api.ActivateAsync(none.Id);
        var draft = await api.ImportDraftAsync();
        Assert.Equal(HttpStatusCode.OK, (await api.PutAsync(draft.Id, PlanSamples.Workout.Replace("Treino B", "Treino Z", StringComparison.Ordinal))).StatusCode);

        var loaded = await api.GetAsync(draft.Id);

        Assert.Equal("days[b].name", Assert.Single(loaded.Diff!.Changed).Path);
        Assert.Null((await api.GetAsync(none.Id)).Diff);
    }
}
