using System.Text.Json;
using ProtocoloApp.Api.Features.Integrations.Hevy;

namespace ProtocoloApp.UnitTests.Integrations;

public sealed class HevyParserTests
{
    private static JsonElement Fixture(string name) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "hevy", name))).RootElement;

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void Workouts_page_reads_page_count_and_items()
    {
        var page = HevyParser.Workouts(Fixture("workouts-page.json"));

        Assert.NotNull(page);
        Assert.Equal(2, page.Page);
        Assert.Equal(5, page.PageCount);
        Assert.Equal(["00000000-0000-4000-8000-00000000a001", "00000000-0000-4000-8000-00000000a002"], page.Items.Select(w => w.Id));
    }

    [Fact]
    public void Workout_fields_exercises_and_sets_are_read()
    {
        var workout = HevyParser.Workouts(Fixture("workouts-page.json"))!.Items[0];

        Assert.Equal("Treino Exemplo A", workout.Title);
        Assert.Equal("Sessão fictícia de exemplo", workout.Description);
        Assert.Equal(new DateTimeOffset(2026, 10, 20, 10, 0, 0, TimeSpan.Zero), workout.StartTime);
        Assert.Equal(new DateTimeOffset(2026, 10, 20, 11, 5, 0, TimeSpan.Zero), workout.EndTime);
        Assert.Equal(new DateTimeOffset(2026, 10, 20, 11, 6, 30, TimeSpan.Zero), workout.UpdatedAt);
        Assert.Equal(2, workout.Exercises.Count);

        var bench = workout.Exercises[0];
        Assert.Equal("Supino Exemplo (Barbell)", bench.Title);
        Assert.Equal("TPL00001", bench.TemplateId);
        Assert.Null(bench.SupersetId);
        Assert.Equal("Nota fictícia", bench.Notes);
        Assert.Equal(["warmup", "normal", "dropset"], bench.Sets.Select(s => s.Type));
        Assert.Equal(new HevySet(1, "normal", 60.5m, 10, null, null, 8.5m), bench.Sets[1]);

        var row = workout.Exercises[1];
        Assert.Equal(1, row.SupersetId);
        Assert.Null(row.Notes);
        Assert.Equal(new HevySet(0, "failure", 22m, 9, null, null, 10m), Assert.Single(row.Sets));
    }

    [Fact]
    public void Item_without_id_is_skipped_and_counted()
    {
        var page = HevyParser.Workouts(Fixture("workouts-page.json"));

        Assert.Equal(1, page!.Skipped);
    }

    [Fact]
    public void Odd_fields_are_tolerated()
    {
        var page = HevyParser.Workouts(Fixture("workout-odd-fields.json"));

        Assert.NotNull(page);
        // The one without start_time is skipped; unknown fields everywhere are ignored.
        Assert.Equal(1, page.Skipped);
        Assert.Equal(2, page.Items.Count);

        var odd = page.Items[0];
        Assert.Null(odd.EndTime);
        Assert.Null(odd.Description);
        Assert.Equal(new DateTimeOffset(2026, 10, 19, 8, 0, 0, TimeSpan.Zero), odd.StartTime);
        var sets = Assert.Single(odd.Exercises).Sets;
        // Raw values: the mapper (Task 6) decides what a null weight, a duration-only set or rpe 11 become.
        Assert.Equal(2, sets.Count);
        Assert.Equal(new HevySet(0, "normal", null, 12, null, null, 11m), sets[0]);
        Assert.Equal(new HevySet(1, "normal", null, null, null, 60, null), sets[1]);
    }

    [Fact]
    public void Missing_exercises_is_an_empty_list()
    {
        var page = HevyParser.Workouts(Fixture("workout-odd-fields.json"));

        Assert.Empty(page!.Items[1].Exercises);
    }

    [Fact]
    public void Unexpected_envelope_is_null_not_an_empty_page()
    {
        Assert.Null(HevyParser.Workouts(Fixture("unexpected-envelope.json")));
        Assert.Null(HevyParser.Events(Fixture("unexpected-envelope.json")));
        Assert.Null(HevyParser.Templates(Fixture("unexpected-envelope.json")));
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("\"text\"")]
    [InlineData("""{"workouts":{"a":1}}""")]
    [InlineData("""{"workouts":null}""")]
    public void Workouts_that_are_not_an_array_are_null(string json)
    {
        Assert.Null(HevyParser.Workouts(Json(json)));
    }

    [Fact]
    public void A_page_where_no_item_is_readable_is_a_format_failure()
    {
        Assert.Null(HevyParser.Workouts(Json("""{"page":1,"page_count":1,"workouts":[{"name":"x"},{"id":"y"}]}""")));
    }

    [Fact]
    public void An_empty_list_is_an_empty_page()
    {
        var page = HevyParser.Workouts(Json("""{"page":1,"page_count":0,"workouts":[]}"""));

        Assert.NotNull(page);
        Assert.Empty(page.Items);
        Assert.Equal(0, page.Skipped);
    }

    [Fact]
    public void Missing_page_numbers_mean_a_single_page()
    {
        var page = HevyParser.Workouts(Json("""{"workouts":[]}"""));

        Assert.Equal(1, page!.Page);
        Assert.Equal(1, page.PageCount);
    }

    [Fact]
    public void Missing_set_index_falls_back_to_the_position_and_missing_type_to_normal()
    {
        var page = HevyParser.Workouts(Json("""
            {"workouts":[{"id":"w1","title":"T","start_time":"2026-10-01T10:00:00Z","updated_at":"2026-10-01T11:00:00Z",
              "exercises":[{"title":"E","exercise_template_id":"T1","sets":[{"reps":5},{"reps":6,"type":"weird"}]}]}]}
            """));

        var sets = page!.Items[0].Exercises[0].Sets;
        Assert.Equal([0, 1], sets.Select(s => s.Index));
        Assert.Equal(["normal", "weird"], sets.Select(s => s.Type));
    }

    [Fact]
    public void Exercise_without_template_id_is_dropped()
    {
        var page = HevyParser.Workouts(Json("""
            {"workouts":[{"id":"w1","title":"T","start_time":"2026-10-01T10:00:00Z","updated_at":"2026-10-01T11:00:00Z",
              "exercises":[{"title":"No template","sets":[]},{"title":"E","exercise_template_id":"T1","sets":[]}]}]}
            """));

        Assert.Equal(["T1"], page!.Items[0].Exercises.Select(e => e.TemplateId));
    }

    [Fact]
    public void Missing_updated_at_falls_back_to_created_at_then_start_time()
    {
        var page = HevyParser.Workouts(Json("""
            {"workouts":[
              {"id":"w1","start_time":"2026-10-01T10:00:00Z","created_at":"2026-10-01T12:00:00Z"},
              {"id":"w2","start_time":"2026-10-02T10:00:00Z"}]}
            """));

        Assert.Equal(new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero), page!.Items[0].UpdatedAt);
        Assert.Equal(new DateTimeOffset(2026, 10, 2, 10, 0, 0, TimeSpan.Zero), page.Items[1].UpdatedAt);
        Assert.Equal("", page.Items[0].Title);
    }

    [Fact]
    public void Fractional_reps_are_ignored_but_integral_decimals_are_read()
    {
        var page = HevyParser.Workouts(Json("""
            {"workouts":[{"id":"w1","start_time":"2026-10-01T10:00:00Z",
              "exercises":[{"title":"E","exercise_template_id":"T1","sets":[{"index":0,"reps":8.0},{"index":1,"reps":7.5},{"index":2,"reps":"8"}]}]}]}
            """));

        Assert.Equal([8, null, null], page!.Items[0].Exercises[0].Sets.Select(s => s.Reps));
    }

    [Fact]
    public void Events_read_updated_and_deleted_and_skip_unknown_types()
    {
        var page = HevyParser.Events(Fixture("events-page.json"));

        Assert.NotNull(page);
        Assert.Equal(1, page.Page);
        Assert.Equal(1, page.PageCount);
        Assert.Equal(2, page.Items.Count);
        Assert.Equal(1, page.Skipped);

        var updated = page.Items[0];
        Assert.Equal("updated", updated.Type);
        Assert.Equal("00000000-0000-4000-8000-00000000a003", updated.Workout!.Id);
        Assert.Equal(80m, updated.Workout.Exercises[0].Sets[0].WeightKg);
        Assert.Null(updated.DeletedId);

        var deleted = page.Items[1];
        Assert.Equal("deleted", deleted.Type);
        Assert.Null(deleted.Workout);
        Assert.Equal("00000000-0000-4000-8000-00000000a004", deleted.DeletedId);
        Assert.Equal(new DateTimeOffset(2026, 10, 23, 12, 0, 0, TimeSpan.Zero), deleted.DeletedAt);
    }

    [Fact]
    public void A_page_of_only_unknown_event_types_is_an_empty_page_not_a_format_failure()
    {
        var page = HevyParser.Events(Json("""{"page":1,"page_count":1,"events":[{"type":"archived","id":"x"}]}"""));

        Assert.NotNull(page);
        Assert.Empty(page.Items);
        Assert.Equal(1, page.Skipped);
    }

    [Fact]
    public void Malformed_known_events_are_skipped()
    {
        var page = HevyParser.Events(Json("""
            {"events":[
              {"type":"updated"},
              {"type":"deleted"},
              {"type":"deleted","id":"d1"}]}
            """));

        Assert.Equal(2, page!.Skipped);
        var deleted = Assert.Single(page.Items);
        Assert.Equal("d1", deleted.DeletedId);
        Assert.Null(deleted.DeletedAt);
    }

    [Fact]
    public void Single_workout_is_read_bare_or_wrapped()
    {
        const string body = """{"id":"w1","title":"Treino Exemplo","start_time":"2026-10-01T10:00:00Z","updated_at":"2026-10-01T11:00:00Z","exercises":[]}""";

        Assert.Equal("w1", HevyParser.Workout(Json(body))!.Id);
        Assert.Equal("w1", HevyParser.Workout(Json($$"""{"workout":{{body}}}"""))!.Id);
        Assert.Null(HevyParser.Workout(Json("""{"title":"no id"}""")));
        Assert.Null(HevyParser.Workout(Json("[]")));
    }

    [Fact]
    public void Templates_page_reads_id_title_and_primary_group()
    {
        var page = HevyParser.Templates(Fixture("exercise-templates-page.json"));

        Assert.NotNull(page);
        Assert.Equal(3, page.PageCount);
        Assert.Equal(1, page.Skipped);
        Assert.Equal(
            [new HevyTemplate("TPL00001", "Supino Exemplo (Barbell)", "chest"), new HevyTemplate("TPL00002", "Exercício Exemplo Personalizado", null)],
            page.Items);
    }
}
