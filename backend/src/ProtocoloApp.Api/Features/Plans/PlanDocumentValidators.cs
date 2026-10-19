using FluentValidation;

namespace ProtocoloApp.Api.Features.Plans;

internal static class PlanDocumentRules
{
    public const int MaxRestSeconds = 900;

    public static readonly string[] Weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

    public static readonly string[] ItemCategories = ["supplement", "compound", "hormone", "thermogenic", "sleep_optional"];

    public static readonly string[] Timings =
        ["any", "fasting", "after_meal", "before_bed", "pre_workout", "intra_workout", "post_workout"];

    public static readonly string[] ScheduleTypes = ["daily", "weekdays", "every_n_days", "training_days_only", "off_days_only"];

    public static readonly string[] GuidelineKinds = ["water_min_l", "free_meals_per_week", "text"];

    public static bool IsValidTiming(string? timing) =>
        timing is not null && (Timings.Contains(timing, StringComparer.Ordinal)
            || (timing.StartsWith("with_meal:", StringComparison.Ordinal) && timing.Length > "with_meal:".Length));
}

/// <summary>
/// Structural rules of a protocol document. A failure's <c>PropertyName</c> is the JSON path (<c>items[1].category</c>).
/// A protocol with no meals, no items and no <c>updateDate</c> is valid: the review screen fills it in.
/// </summary>
public sealed class ProtocolDocumentValidator : AbstractValidator<ProtocolDocument>
{
    public ProtocolDocumentValidator()
    {
        RuleFor(d => d).Custom((doc, context) =>
        {
            void Fail(string path, string message) => context.AddFailure(path, message);

            if (doc.BillingDate is { } billing && doc.UpdateDate is { } update && billing < update)
                Fail("billingDate", "A mensalidade não pode ser anterior à atualização.");

            AddDuplicateKeys(doc.Meals.Select(m => m.Key), "meals", Fail);
            for (var i = 0; i < doc.Meals.Count; i++)
            {
                var meal = doc.Meals[i];
                if (string.IsNullOrWhiteSpace(meal.Key))
                    Fail($"meals[{i}].key", "Obrigatório.");
                for (var j = 0; j < meal.Items.Count; j++)
                {
                    var item = meal.Items[j];
                    if (string.IsNullOrWhiteSpace(item.Food))
                        Fail($"meals[{i}].items[{j}].food", "Obrigatório.");
                    if (item.Grams is < 0 or > 10000)
                        Fail($"meals[{i}].items[{j}].grams", "Fora da faixa.");
                }
            }

            AddDuplicateKeys(doc.Items.Select(i => i.Key), "items", Fail);
            for (var i = 0; i < doc.Items.Count; i++)
            {
                var item = doc.Items[i];
                if (string.IsNullOrWhiteSpace(item.Key))
                    Fail($"items[{i}].key", "Obrigatório.");
                if (string.IsNullOrWhiteSpace(item.Name))
                    Fail($"items[{i}].name", "Obrigatório.");
                if (!PlanDocumentRules.ItemCategories.Contains(item.Category, StringComparer.Ordinal))
                    Fail($"items[{i}].category", "Categoria desconhecida.");
                if (!PlanDocumentRules.IsValidTiming(item.Timing))
                    Fail($"items[{i}].timing", "Horário desconhecido.");
                ValidateSchedule(item.Schedule, $"items[{i}].schedule", Fail);
            }

            if (doc.Cardio is { } cardio)
            {
                if (cardio.SessionsPerWeek is < 0 or > 14)
                    Fail("cardio.sessionsPerWeek", "Fora da faixa.");
                if (cardio.DurationMin is < 0 or > 300)
                    Fail("cardio.durationMin", "Fora da faixa.");
            }

            for (var i = 0; i < doc.Guidelines.Count; i++)
            {
                var guideline = doc.Guidelines[i];
                if (!PlanDocumentRules.GuidelineKinds.Contains(guideline.Kind, StringComparer.Ordinal))
                    Fail($"guidelines[{i}].kind", "Tipo desconhecido.");
                else if (guideline.Kind == "text" && string.IsNullOrWhiteSpace(guideline.Text))
                    Fail($"guidelines[{i}].text", "Obrigatório.");
                else if (guideline.Kind != "text" && guideline.Value is null or < 0)
                    Fail($"guidelines[{i}].value", "Obrigatório.");
            }
        });
    }

    private static void ValidateSchedule(ScheduleDto schedule, string path, Action<string, string> fail)
    {
        if (!PlanDocumentRules.ScheduleTypes.Contains(schedule.Type, StringComparer.Ordinal))
        {
            fail($"{path}.type", "Tipo de agenda desconhecido.");
            return;
        }

        switch (schedule.Type)
        {
            case "weekdays" when schedule.Days is not { Count: > 0 } || schedule.Days.Any(d => !PlanDocumentRules.Weekdays.Contains(d, StringComparer.Ordinal)):
                fail($"{path}.days", "Informe dias entre mon..sun.");
                break;
            case "every_n_days" when schedule.N is null or < 1 or > 365:
                fail($"{path}.n", "Fora da faixa.");
                break;
        }
    }

    internal static void AddDuplicateKeys(IEnumerable<string> keys, string path, Action<string, string> fail)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        if (keys.Where(k => !string.IsNullOrWhiteSpace(k)).Any(k => !seen.Add(k)))
            fail(path, "Chaves repetidas.");
    }
}

/// <summary>
/// Structural rules of a workout document: at least one day, unique day keys, a non-empty rotation that only points to
/// existing days (or <c>off</c>), fixed weekdays covering the week, exercises with sets, ordered reps and rest in range.
/// A failure's <c>PropertyName</c> is the JSON path (<c>rotation.items</c>, <c>days[0].exercises[1].sets</c>).
/// </summary>
public sealed class WorkoutDocumentValidator : AbstractValidator<WorkoutDocument>
{
    private const int MaxReps = 200;

    public WorkoutDocumentValidator()
    {
        RuleFor(d => d).Custom((doc, context) =>
        {
            void Fail(string path, string message) => context.AddFailure(path, message);

            if (doc.Days.Count == 0)
                Fail("days", "Informe ao menos um dia de treino.");
            ProtocolDocumentValidator.AddDuplicateKeys(doc.Days.Select(d => d.Key), "days", Fail);

            var dayKeys = doc.Days.Select(d => d.Key).Where(k => !string.IsNullOrWhiteSpace(k)).ToHashSet(StringComparer.Ordinal);
            ValidateRotation(doc.Rotation, dayKeys, Fail);
            for (var i = 0; i < doc.Days.Count; i++)
                ValidateDay(doc.Days[i], $"days[{i}]", Fail);
        });
    }

    private static void ValidateRotation(RotationDto? rotation, HashSet<string> dayKeys, Action<string, string> fail)
    {
        if (rotation is null)
        {
            fail("rotation", "Obrigatório.");
            return;
        }

        bool Known(string key) => key == RotationDto.Off || dayKeys.Contains(key);

        switch (rotation.Type)
        {
            case RotationDto.Sequence:
                if (rotation.Items is not { Count: > 0 })
                    fail("rotation.items", "A rotação não pode ficar vazia.");
                else if (rotation.Items.Any(item => !Known(item)))
                    fail("rotation.items", "A rotação usa um dia que não existe.");
                break;
            case RotationDto.FixedWeekdays:
                if (rotation.Map is null || PlanDocumentRules.Weekdays.Any(day => !rotation.Map.ContainsKey(day)))
                    fail("rotation.map", "Informe os 7 dias da semana (mon..sun).");
                else if (rotation.Map.Any(entry => !PlanDocumentRules.Weekdays.Contains(entry.Key, StringComparer.Ordinal) || !Known(entry.Value)))
                    fail("rotation.map", "A rotação usa um dia que não existe.");
                break;
            default:
                fail("rotation.type", "Tipo de rotação desconhecido.");
                break;
        }
    }

    private static void ValidateDay(WorkoutDayDto day, string path, Action<string, string> fail)
    {
        if (string.IsNullOrWhiteSpace(day.Key))
            fail($"{path}.key", "Obrigatório.");
        else if (day.Key == RotationDto.Off)
            fail($"{path}.key", "\"off\" é reservado para descanso.");

        ProtocolDocumentValidator.AddDuplicateKeys(day.Exercises.Select(e => e.Key), $"{path}.exercises", fail);
        for (var j = 0; j < day.Exercises.Count; j++)
        {
            var exercise = day.Exercises[j];
            var exercisePath = $"{path}.exercises[{j}]";
            if (string.IsNullOrWhiteSpace(exercise.Key))
                fail($"{exercisePath}.key", "Obrigatório.");
            if (string.IsNullOrWhiteSpace(exercise.Name))
                fail($"{exercisePath}.name", "Obrigatório.");
            if (exercise.Sets.Count == 0)
                fail($"{exercisePath}.sets", "Informe ao menos uma série.");

            for (var k = 0; k < exercise.Sets.Count; k++)
            {
                var set = exercise.Sets[k];
                if (set.RepsMin < 0 || set.RepsMax > MaxReps || set.RepsMin > set.RepsMax)
                    fail($"{exercisePath}.sets[{k}]", "Repetições inválidas (mín. ≤ máx., 0–200).");
            }

            if (exercise.RestSeconds is < 0 or > PlanDocumentRules.MaxRestSeconds)
                fail($"{exercisePath}.restSeconds", "Descanso fora da faixa (0–900 s).");
            if (exercise.RestSequence is { } sequence
                && (sequence.Count == 0 || sequence.Any(s => s is < 0 or > PlanDocumentRules.MaxRestSeconds)))
            {
                fail($"{exercisePath}.restSequence", "Descanso fora da faixa (0–900 s).");
            }
        }
    }
}
