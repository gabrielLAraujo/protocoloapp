using System.Text.Json;
using System.Text.RegularExpressions;
using FluentValidation;
using ProtocoloApp.Api.Features.Plans;

namespace ProtocoloApp.Api.Features.Updates;

/// <summary>
/// The questionnaire template (<c>questionnaire_template.document</c>), camelCase JSON like the plan documents:
/// <c>{ title, sections: [{ title, questions: [{ key, text, kind, options?, fill?, default?, fillOptions? }] }], poses: [{ key, label }] }</c>.
/// Its texts are the coach's content: they never go to the logs or to the repository.
/// </summary>
public sealed record QuestionnaireTemplateDocument
{
    public string? Title { get; init; }

    public IReadOnlyList<QuestionnaireSectionDto?>? Sections { get; init; }

    public IReadOnlyList<QuestionnairePoseDto?>? Poses { get; init; }
}

public sealed record QuestionnaireSectionDto
{
    public string? Title { get; init; }

    public IReadOnlyList<QuestionnaireQuestionDto?>? Questions { get; init; }
}

public sealed record QuestionnaireQuestionDto
{
    public string? Key { get; init; }

    public string? Text { get; init; }

    /// <summary><c>text</c>, <c>long_text</c>, <c>number</c> or <c>choice</c>.</summary>
    public string? Kind { get; init; }

    /// <summary>Required for (and only for) <c>choice</c>.</summary>
    public IReadOnlyList<string?>? Options { get; init; }

    /// <summary>Null or one of <see cref="FillMetric.All"/>.</summary>
    public string? Fill { get; init; }

    /// <summary>The answer's initial text (up to 4000), used when there is neither an edit nor a calculation.</summary>
    public string? Default { get; init; }

    /// <summary>Parameters of the <see cref="Fill"/> calculation; only with a fill that accepts each one.</summary>
    public QuestionnaireFillOptionsDto? FillOptions { get; init; }
}

/// <summary>
/// <c>week</c> (1 to 6, <see cref="FillMetric.WeekMetrics"/>), <c>categories</c> (protocol item categories,
/// <see cref="FillMetric.CategoryMetrics"/>) and <c>groups</c> (<see cref="MuscleGroup"/> in snake_case,
/// <see cref="FillMetric.GroupMetrics"/>).
/// </summary>
public sealed record QuestionnaireFillOptionsDto
{
    public int? Week { get; init; }

    public IReadOnlyList<string?>? Categories { get; init; }

    public IReadOnlyList<string?>? Groups { get; init; }
}

public sealed record QuestionnairePoseDto
{
    public string? Key { get; init; }

    public string? Label { get; init; }
}

internal static partial class QuestionnaireRules
{
    public const int MaxTitleLength = 120;
    public const int MaxSections = 30;
    public const int MaxQuestionsPerSection = 60;
    public const int MaxQuestions = 300;
    public const int MaxTextLength = 1000;
    public const int MinOptions = 2;
    public const int MaxOptions = 20;
    public const int MaxOptionLength = 120;
    public const int MaxPoses = 12;
    public const int MaxPoseLabelLength = 40;
    public const int MaxAnswerLength = 4000;
    public const int MaxDefaultLength = MaxAnswerLength;
    public const int MinWeek = 1;
    public const int MaxWeek = 6;

    public static readonly string[] Kinds = ["text", "long_text", "number", "choice"];

    /// <summary>A question key (also an answer key): lowercase letters, digits and <c>_</c>, 1 to 64.</summary>
    [GeneratedRegex("^[a-z0-9_]{1,64}\\z")]
    public static partial Regex QuestionKey();

    /// <summary>A pose key: lowercase letters, digits and <c>_</c>, 1 to 32.</summary>
    [GeneratedRegex("^[a-z0-9_]{1,32}\\z")]
    public static partial Regex PoseKey();

    public static bool IsText(string? value, int max) => !string.IsNullOrWhiteSpace(value) && value.Length <= max;

    /// <summary>Structural rules of a template; <paramref name="fail"/> gets the JSON path relative to the document.</summary>
    public static void Validate(QuestionnaireTemplateDocument doc, Action<string, string> fail)
    {
        if (!IsText(doc.Title, MaxTitleLength))
            fail("title", $"Informe um título de até {MaxTitleLength} caracteres.");

        var sections = doc.Sections ?? [];
        if (sections.Count is 0 or > MaxSections)
            fail("sections", $"Informe de 1 a {MaxSections} seções.");
        if (sections.Sum(s => s?.Questions?.Count ?? 0) > MaxQuestions)
            fail("sections", $"No máximo {MaxQuestions} perguntas no total.");

        var keys = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < sections.Count; i++)
        {
            var section = sections[i];
            var sectionPath = $"sections[{i}]";
            if (section is null)
            {
                fail(sectionPath, "Obrigatório.");
                continue;
            }

            if (!IsText(section.Title, MaxTitleLength))
                fail($"{sectionPath}.title", $"Informe um título de até {MaxTitleLength} caracteres.");

            var questions = section.Questions ?? [];
            if (questions.Count is 0 or > MaxQuestionsPerSection)
                fail($"{sectionPath}.questions", $"Informe de 1 a {MaxQuestionsPerSection} perguntas por seção.");

            for (var j = 0; j < questions.Count; j++)
                ValidateQuestion(questions[j], $"{sectionPath}.questions[{j}]", keys, fail);
        }

        var poses = doc.Poses ?? [];
        if (poses.Count > MaxPoses)
            fail("poses", $"No máximo {MaxPoses} poses.");
        var poseKeys = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < poses.Count; i++)
        {
            var pose = poses[i];
            var path = $"poses[{i}]";
            if (pose is null)
            {
                fail(path, "Obrigatório.");
                continue;
            }

            if (pose.Key is null || !PoseKey().IsMatch(pose.Key))
                fail($"{path}.key", "Use de 1 a 32 letras minúsculas, números ou _.");
            else if (!poseKeys.Add(pose.Key))
                fail($"{path}.key", "Pose repetida.");
            if (!IsText(pose.Label, MaxPoseLabelLength))
                fail($"{path}.label", $"Informe um nome de até {MaxPoseLabelLength} caracteres.");
        }
    }

    private static void ValidateQuestion(QuestionnaireQuestionDto? question, string path, HashSet<string> keys, Action<string, string> fail)
    {
        if (question is null)
        {
            fail(path, "Obrigatório.");
            return;
        }

        if (question.Key is null || !QuestionKey().IsMatch(question.Key))
            fail($"{path}.key", "Use de 1 a 64 letras minúsculas, números ou _.");
        else if (!keys.Add(question.Key))
            fail($"{path}.key", "Chave repetida no modelo.");

        if (!IsText(question.Text, MaxTextLength))
            fail($"{path}.text", $"Informe um texto de até {MaxTextLength} caracteres.");

        if (question.Kind is null || !Kinds.Contains(question.Kind, StringComparer.Ordinal))
            fail($"{path}.kind", "Tipo de pergunta desconhecido.");
        else if (question.Kind == "choice")
        {
            if (question.Options is not { Count: >= MinOptions and <= MaxOptions } options || options.Any(o => !IsText(o, MaxOptionLength)))
                fail($"{path}.options", $"Informe de {MinOptions} a {MaxOptions} opções de até {MaxOptionLength} caracteres.");
        }
        else if (question.Options is { Count: > 0 })
        {
            fail($"{path}.options", "Só perguntas de escolha têm opções.");
        }

        if (question.Fill is not null && !FillMetric.IsKnown(question.Fill))
            fail($"{path}.fill", "Métrica desconhecida.");

        if (question.Default is { Length: > MaxDefaultLength })
            fail($"{path}.default", $"Informe um valor inicial de até {MaxDefaultLength} caracteres.");

        if (question.FillOptions is { } fillOptions)
            ValidateFillOptions(fillOptions, question.Fill, $"{path}.fillOptions", fail);
    }

    private static void ValidateFillOptions(QuestionnaireFillOptionsDto options, string? fill, string path, Action<string, string> fail)
    {
        bool Accepts(IReadOnlyList<string> metrics) => fill is not null && metrics.Contains(fill, StringComparer.Ordinal);

        if (options.Week is { } week)
        {
            if (!Accepts(FillMetric.WeekMetrics))
                fail($"{path}.week", "Essa métrica não aceita semana.");
            else if (week is < MinWeek or > MaxWeek)
                fail($"{path}.week", $"Informe uma semana de {MinWeek} a {MaxWeek}.");
        }

        if (options.Categories is { } categories)
        {
            if (!Accepts(FillMetric.CategoryMetrics))
                fail($"{path}.categories", "Essa métrica não aceita categorias.");
            else if (!IsSubset(categories, PlanDocumentRules.ItemCategories))
                fail($"{path}.categories", "Informe categorias conhecidas, sem repetir.");
        }

        if (options.Groups is { } groups)
        {
            if (!Accepts(FillMetric.GroupMetrics))
                fail($"{path}.groups", "Essa métrica não aceita grupos.");
            else if (!IsSubset(groups, EnumText.Values<MuscleGroup>()))
                fail($"{path}.groups", "Informe grupos musculares conhecidos, sem repetir.");
        }
    }

    /// <summary>At least one value, every one in <paramref name="known"/>, none repeated.</summary>
    private static bool IsSubset(IReadOnlyList<string?> values, IReadOnlyList<string> known) =>
        values.Count > 0
        && values.All(v => v is not null && known.Contains(v, StringComparer.Ordinal))
        && values.Distinct(StringComparer.Ordinal).Count() == values.Count;
}

/// <summary><c>questionnaire_template</c>: <c>{document}</c>, a <see cref="QuestionnaireTemplateDocument"/>.</summary>
public sealed record QuestionnaireTemplatePayload
{
    public JsonElement? Document { get; init; }
}

/// <summary>
/// Reads the document and applies <see cref="QuestionnaireRules"/>. A failure's <c>PropertyName</c> is the JSON path from
/// the payload (<c>document.sections[1].questions[0].key</c>).
/// </summary>
public sealed class QuestionnaireTemplatePayloadValidator : AbstractValidator<QuestionnaireTemplatePayload>
{
    private const string DocumentField = "document";

    public QuestionnaireTemplatePayloadValidator()
    {
        RuleFor(p => p).Custom((payload, context) =>
        {
            if (payload.Document is not { ValueKind: JsonValueKind.Object } json)
            {
                context.AddFailure(DocumentField, "Obrigatório.");
                return;
            }

            if (!PlanDocuments.TryRead<QuestionnaireTemplateDocument>(json, out var document, out var unreadable))
            {
                foreach (var path in unreadable.Distinct(StringComparer.Ordinal))
                    context.AddFailure(path == DocumentField ? DocumentField : $"{DocumentField}.{path}", "Valor inválido.");
                return;
            }

            QuestionnaireRules.Validate(document!, (path, message) => context.AddFailure($"{DocumentField}.{path}", message));
        });
    }
}
