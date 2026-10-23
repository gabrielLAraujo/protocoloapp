using System.Text.Json;
using System.Text.Json.Nodes;
using ProtocoloApp.Api.Features.Updates;

namespace ProtocoloApp.UnitTests.Updates;

/// <summary>Rules of the questionnaire template document, on the fictitious fixture shared with the front.</summary>
public sealed class QuestionnaireTemplateValidatorTests
{
    private static readonly QuestionnaireTemplatePayloadValidator Validator = new();

    private static JsonObject Fixture() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "questionnaire-template.example.json")))!.AsObject();

    private static List<string> Errors(JsonNode document)
    {
        var payload = new QuestionnaireTemplatePayload { Document = JsonSerializer.SerializeToElement(document) };
        return Validator.Validate(payload).Errors.Select(e => e.PropertyName).Distinct().ToList();
    }

    private static JsonObject Question(JsonObject document, int section, int question) =>
        document["sections"]![section]!["questions"]![question]!.AsObject();

    [Fact]
    public void The_fixture_is_valid()
    {
        Assert.Empty(Errors(Fixture()));
    }

    [Fact]
    public void The_fixture_uses_every_kind_and_the_default_poses()
    {
        var document = Fixture();
        var questions = document["sections"]!.AsArray().SelectMany(s => s!["questions"]!.AsArray()).ToList();
        Assert.Equal(3, document["sections"]!.AsArray().Count);
        Assert.Equal(
            ["choice", "long_text", "number", "text"],
            questions.Select(q => q!["kind"]!.GetValue<string>()).Distinct().Order(StringComparer.Ordinal).ToList());
        Assert.Equal(
            ["checkin_notes", "diet_error_pct", "missed_workouts", "weight"],
            questions.Where(q => q!["fill"] is not null).Select(q => q!["fill"]!.GetValue<string>()).Order(StringComparer.Ordinal).ToList());
        Assert.Equal(
            ["front", "back", "right_side", "left_side", "abs"],
            document["poses"]!.AsArray().Select(p => p!["key"]!.GetValue<string>()).ToList());
        Assert.All(questions.Select(q => q!["fill"]?.GetValue<string>()).OfType<string>(), fill => Assert.Contains(fill, FillMetric.All));
    }

    [Fact]
    public void A_key_repeated_in_another_section_is_reported_on_the_second_one()
    {
        var document = Fixture();
        Question(document, 1, 0)["key"] = Question(document, 0, 0)["key"]!.GetValue<string>();

        Assert.Equal(["document.sections[1].questions[0].key"], Errors(document));
    }

    [Theory]
    [InlineData("A b")]
    [InlineData("")]
    public void A_malformed_key_is_an_error(string key)
    {
        var document = Fixture();
        Question(document, 0, 0)["key"] = key;

        Assert.Equal(["document.sections[0].questions[0].key"], Errors(document));
    }

    [Fact]
    public void An_unknown_fill_is_an_error()
    {
        var document = Fixture();
        Question(document, 0, 1)["fill"] = "foo";

        Assert.Equal(["document.sections[0].questions[1].fill"], Errors(document));
    }

    [Fact]
    public void A_null_fill_is_fine()
    {
        var document = Fixture();
        Question(document, 0, 1)["fill"] = null;

        Assert.Empty(Errors(document));
    }

    [Fact]
    public void Choice_needs_options_and_other_kinds_cannot_have_them()
    {
        var document = Fixture();
        Question(document, 0, 1).Remove("options");
        Question(document, 1, 0)["options"] = new JsonArray("A", "B");

        var errors = Errors(document);

        Assert.Contains("document.sections[0].questions[1].options", errors);
        Assert.Contains("document.sections[1].questions[0].options", errors);
        Assert.Equal(2, errors.Count);
    }

    [Fact]
    public void Choice_with_a_single_option_is_an_error()
    {
        var document = Fixture();
        Question(document, 0, 1)["options"] = new JsonArray("Opção A");

        Assert.Equal(["document.sections[0].questions[1].options"], Errors(document));
    }

    [Fact]
    public void An_unknown_kind_is_an_error()
    {
        var document = Fixture();
        Question(document, 0, 0)["kind"] = "date";

        Assert.Equal(["document.sections[0].questions[0].kind"], Errors(document));
    }

    [Fact]
    public void More_than_300_questions_is_an_error()
    {
        var document = Fixture();
        var sections = new JsonArray();
        for (var s = 0; s < 6; s++)
        {
            var questions = new JsonArray();
            for (var q = 0; q < (s == 0 ? 51 : 50); q++)
                questions.Add(new JsonObject { ["key"] = $"q_{s}_{q}", ["text"] = "Pergunta de exemplo?", ["kind"] = "text" });
            sections.Add(new JsonObject { ["title"] = $"Seção {s}", ["questions"] = questions });
        }

        document["sections"] = sections;

        Assert.Equal(["document.sections"], Errors(document));
    }

    [Fact]
    public void A_section_without_questions_and_a_template_without_sections_are_errors()
    {
        var empty = Fixture();
        empty["sections"]![0]!["questions"] = new JsonArray();
        var none = Fixture();
        none["sections"] = new JsonArray();

        Assert.Equal(["document.sections[0].questions"], Errors(empty));
        Assert.Equal(["document.sections"], Errors(none));
    }

    [Fact]
    public void A_repeated_pose_is_an_error()
    {
        var document = Fixture();
        document["poses"]![1]!["key"] = "front";

        Assert.Equal(["document.poses[1].key"], Errors(document));
    }

    [Fact]
    public void A_template_without_poses_is_fine()
    {
        var document = Fixture();
        document.Remove("poses");

        Assert.Empty(Errors(document));
    }

    [Fact]
    public void A_blank_title_and_a_long_text_are_errors()
    {
        var document = Fixture();
        document["title"] = " ";
        Question(document, 0, 0)["text"] = new string('a', 1001);

        var errors = Errors(document);

        Assert.Contains("document.title", errors);
        Assert.Contains("document.sections[0].questions[0].text", errors);
    }

    [Fact]
    public void A_missing_or_unreadable_document_is_an_error()
    {
        Assert.Equal(["document"], Validator.Validate(new QuestionnaireTemplatePayload()).Errors.Select(e => e.PropertyName).Distinct().ToList());

        var document = Fixture();
        document["sections"] = "não é uma lista";
        Assert.Equal(["document.sections"], Errors(document));
    }
}
