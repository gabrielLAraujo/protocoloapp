using FluentValidation;

namespace ProtocoloApp.Api.Features.Plans;

internal static class PlanDocumentRules
{
    public const int MaxRestSeconds = 900;

    public const int MaxDays = 14;

    public const int MaxExercisesPerDay = 50;

    public const int MaxSetsPerExercise = 50;

    /// <summary>Cap on the meals of a protocol, on the items of one meal and on the protocol items.</summary>
    public const int MaxMealsOrItems = 100;

    public static readonly string[] Weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

    public static readonly string[] ItemCategories = ["supplement", "compound", "hormone", "thermogenic", "sleep_optional"];

    public static readonly string[] Timings =
        ["any", "fasting", "after_meal", "before_bed", "pre_workout", "intra_workout", "post_workout"];

    public static readonly string[] ScheduleTypes = ["daily", "weekdays", "every_n_days", "training_days_only", "off_days_only"];

    public static readonly string[] GuidelineKinds = ["water_min_l", "free_meals_per_week", "text"];

    /// <summary>
    /// Size caps of a workout (days, exercises per day, sets per exercise), keyed by the path of the list. Also applied to
    /// drafts, which otherwise only have to be readable.
    /// </summary>
    public static void CheckCounts(WorkoutDocument doc, Action<string, string> fail)
    {
        ArgumentNullException.ThrowIfNull(doc);
        ArgumentNullException.ThrowIfNull(fail);

        var days = doc.Days ?? [];
        if (days.Count > MaxDays)
            fail("days", $"No máximo {MaxDays} dias.");
        for (var i = 0; i < days.Count; i++)
        {
            var exercises = days[i]?.Exercises ?? [];
            if (exercises.Count > MaxExercisesPerDay)
                fail($"days[{i}].exercises", $"No máximo {MaxExercisesPerDay} exercícios por dia.");
            for (var j = 0; j < exercises.Count; j++)
            {
                if ((exercises[j]?.Sets ?? []).Count > MaxSetsPerExercise)
                    fail($"days[{i}].exercises[{j}].sets", $"No máximo {MaxSetsPerExercise} séries por exercício.");
            }
        }
    }

    /// <summary>Size caps of a protocol (meals, items of a meal, protocol items), keyed by the path of the list.</summary>
    public static void CheckCounts(ProtocolDocument doc, Action<string, string> fail)
    {
        ArgumentNullException.ThrowIfNull(doc);
        ArgumentNullException.ThrowIfNull(fail);

        var meals = doc.Meals ?? [];
        if (meals.Count > MaxMealsOrItems)
            fail("meals", $"No máximo {MaxMealsOrItems} refeições.");
        for (var i = 0; i < meals.Count; i++)
        {
            if ((meals[i]?.Items ?? []).Count > MaxMealsOrItems)
                fail($"meals[{i}].items", $"No máximo {MaxMealsOrItems} alimentos por refeição.");
        }

        if ((doc.Items ?? []).Count > MaxMealsOrItems)
            fail("items", $"No máximo {MaxMealsOrItems} itens.");
    }

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

            // Explicit JSON nulls ("meals": null, [null]) are treated as empty / reported, never dereferenced.
            var meals = doc.Meals ?? [];
            var items = doc.Items ?? [];
            var guidelines = doc.Guidelines ?? [];
            PlanDocumentRules.CheckCounts(doc, Fail);

            AddDuplicateKeys(meals.Select(m => m?.Key), "meals", Fail);
            for (var i = 0; i < meals.Count; i++)
            {
                var meal = meals[i];
                if (meal is null)
                {
                    Fail($"meals[{i}]", "Obrigatório.");
                    continue;
                }

                if (string.IsNullOrWhiteSpace(meal.Key))
                    Fail($"meals[{i}].key", "Obrigatório.");
                var mealItems = meal.Items ?? [];
                for (var j = 0; j < mealItems.Count; j++)
                {
                    var item = mealItems[j];
                    if (item is null)
                    {
                        Fail($"meals[{i}].items[{j}]", "Obrigatório.");
                        continue;
                    }

                    if (string.IsNullOrWhiteSpace(item.Food))
                        Fail($"meals[{i}].items[{j}].food", "Obrigatório.");
                    if (item.Grams is < 0 or > 10000)
                        Fail($"meals[{i}].items[{j}].grams", "Fora da faixa.");
                }
            }

            AddDuplicateKeys(items.Select(x => x?.Key), "items", Fail);
            for (var i = 0; i < items.Count; i++)
            {
                var item = items[i];
                if (item is null)
                {
                    Fail($"items[{i}]", "Obrigatório.");
                    continue;
                }

                if (string.IsNullOrWhiteSpace(item.Key))
                    Fail($"items[{i}].key", "Obrigatório.");
                if (string.IsNullOrWhiteSpace(item.Name))
                    Fail($"items[{i}].name", "Obrigatório.");
                if (!PlanDocumentRules.ItemCategories.Contains(item.Category, StringComparer.Ordinal))
                    Fail($"items[{i}].category", "Categoria desconhecida.");
                if (!PlanDocumentRules.IsValidTiming(item.Timing))
                    Fail($"items[{i}].timing", "Horário desconhecido.");
                if (item.Schedule is null)
                    Fail($"items[{i}].schedule", "Obrigatório.");
                else
                    ValidateSchedule(item.Schedule, $"items[{i}].schedule", Fail);
            }

            if (doc.Cardio is { } cardio)
            {
                if (cardio.SessionsPerWeek is < 0 or > 14)
                    Fail("cardio.sessionsPerWeek", "Fora da faixa.");
                if (cardio.DurationMin is < 0 or > 300)
                    Fail("cardio.durationMin", "Fora da faixa.");
            }

            for (var i = 0; i < guidelines.Count; i++)
            {
                var guideline = guidelines[i];
                if (guideline is null)
                {
                    Fail($"guidelines[{i}]", "Obrigatório.");
                    continue;
                }

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

    internal static void AddDuplicateKeys(IEnumerable<string?> keys, string path, Action<string, string> fail)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        if (keys.Where(k => !string.IsNullOrWhiteSpace(k)).Any(k => !seen.Add(k!)))
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
    private const int MaxSubSets = 5;

    public WorkoutDocumentValidator()
    {
        RuleFor(d => d).Custom((doc, context) =>
        {
            void Fail(string path, string message) => context.AddFailure(path, message);

            // Explicit JSON nulls ("days": null, [null]) are reported, never dereferenced.
            var days = doc.Days ?? [];
            if (days.Count == 0)
                Fail("days", "Informe ao menos um dia de treino.");
            PlanDocumentRules.CheckCounts(doc, Fail);
            ProtocolDocumentValidator.AddDuplicateKeys(days.Select(d => d?.Key), "days", Fail);

            var dayKeys = days.Select(d => d?.Key).Where(k => !string.IsNullOrWhiteSpace(k)).Select(k => k!).ToHashSet(StringComparer.Ordinal);
            ValidateRotation(doc.Rotation, dayKeys, Fail);
            for (var i = 0; i < days.Count; i++)
            {
                if (days[i] is null)
                    Fail($"days[{i}]", "Obrigatório.");
                else
                    ValidateDay(days[i], $"days[{i}]", Fail);
            }
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
                else if (rotation.Items.Any(item => item is null || !Known(item)))
                    fail("rotation.items", "A rotação usa um dia que não existe.");
                break;
            case RotationDto.FixedWeekdays:
                if (rotation.Map is null || PlanDocumentRules.Weekdays.Any(day => !rotation.Map.ContainsKey(day)))
                    fail("rotation.map", "Informe os 7 dias da semana (mon..sun).");
                else if (rotation.Map.Any(entry => !PlanDocumentRules.Weekdays.Contains(entry.Key, StringComparer.Ordinal) || entry.Value is null || !Known(entry.Value)))
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

        var exercises = day.Exercises ?? [];
        ProtocolDocumentValidator.AddDuplicateKeys(exercises.Select(e => e?.Key), $"{path}.exercises", fail);
        for (var j = 0; j < exercises.Count; j++)
        {
            var exercise = exercises[j];
            var exercisePath = $"{path}.exercises[{j}]";
            if (exercise is null)
            {
                fail(exercisePath, "Obrigatório.");
                continue;
            }

            if (string.IsNullOrWhiteSpace(exercise.Key))
                fail($"{exercisePath}.key", "Obrigatório.");
            if (string.IsNullOrWhiteSpace(exercise.Name))
                fail($"{exercisePath}.name", "Obrigatório.");
            var sets = exercise.Sets ?? [];
            if (sets.Count == 0)
                fail($"{exercisePath}.sets", "Informe ao menos uma série.");

            for (var k = 0; k < sets.Count; k++)
            {
                var set = sets[k];
                if (set is null)
                {
                    fail($"{exercisePath}.sets[{k}]", "Obrigatório.");
                    continue;
                }

                if (set.RepsMin < 0 || set.RepsMax > MaxReps || set.RepsMin > set.RepsMax)
                    fail($"{exercisePath}.sets[{k}]", "Repetições inválidas (mín. ≤ máx., 0–200).");
                if (set.Drops is < 0 or > MaxSubSets)
                    fail($"{exercisePath}.sets[{k}].drops", "Drops fora da faixa (0–5).");
                if (set.RestPause is < 0 or > MaxSubSets)
                    fail($"{exercisePath}.sets[{k}].restPause", "Rest-pause fora da faixa (0–5).");
            }

            var techniques = exercise.Techniques ?? [];
            for (var t = 0; t < techniques.Count; t++)
                ValidateTechnique(techniques[t], $"{exercisePath}.techniques[{t}]", exercise, exercises, fail);

            if (exercise.RestSeconds is < 0 or > PlanDocumentRules.MaxRestSeconds)
                fail($"{exercisePath}.restSeconds", "Descanso fora da faixa (0–900 s).");
            if (exercise.RestSequence is { } sequence
                && (sequence.Count == 0 || sequence.Any(v => v is < 0 or > PlanDocumentRules.MaxRestSeconds)))
            {
                fail($"{exercisePath}.restSequence", "Descanso fora da faixa (0–900 s).");
            }
        }
    }

    private static void ValidateTechnique(TechniqueDto? technique, string path, PlannedExerciseDto exercise, IReadOnlyList<PlannedExerciseDto> day, Action<string, string> fail)
    {
        if (technique is null)
        {
            fail(path, "Obrigatório.");
            return;
        }

        bool Between(int? value, int min, int max) => value is { } v && v >= min && v <= max;

        switch (technique.Type)
        {
            case TechniqueTypes.Drop:
                if (!Between(technique.Count, 1, 5))
                    fail($"{path}.count", "Quantidade de drops fora da faixa (1–5).");
                if (!ValidDropSets(technique.Sets, (exercise.Sets ?? []).Count))
                    fail($"{path}.sets", "Informe \"last\", \"all\" ou os índices das séries.");
                break;
            case TechniqueTypes.RestPause:
                if (!Between(technique.Count, 1, 5))
                    fail($"{path}.count", "Quantidade de rest-pause fora da faixa (1–5).");
                break;
            case TechniqueTypes.Biset:
                if (string.IsNullOrWhiteSpace(technique.With)
                    || technique.With == exercise.Key
                    || !day.Any(e => e is not null && e.Key == technique.With))
                {
                    fail($"{path}.with", "O bi-set precisa de outro exercício do mesmo dia.");
                }

                break;
            case TechniqueTypes.Sst:
                if (technique.Rests is not { Count: > 0 } || technique.Rests.Any(v => v is < 0 or > PlanDocumentRules.MaxRestSeconds))
                    fail($"{path}.rests", "Descanso fora da faixa (0–900 s).");
                break;
            case TechniqueTypes.Peak:
            case TechniqueTypes.ZeroPoint:
                if (!Between(technique.Seconds, 1, 10))
                    fail($"{path}.seconds", "Segundos fora da faixa (1–10).");
                break;
            case TechniqueTypes.Isometric:
                if (!Between(technique.Seconds, 1, 120))
                    fail($"{path}.seconds", "Segundos fora da faixa (1–120).");
                break;
            case TechniqueTypes.Partials:
                if (technique.Reps is { } reps && !Between(reps, 1, 30))
                    fail($"{path}.reps", "Repetições fora da faixa (1–30).");
                break;
            case TechniqueTypes.ProgressiveLoad:
            case TechniqueTypes.StretchInterval:
                break;
            default:
                fail($"{path}.type", "Técnica desconhecida.");
                break;
        }
    }

    private static bool ValidDropSets(System.Text.Json.JsonElement? sets, int setCount)
    {
        if (sets is not { } element)
            return false;
        return element.ValueKind switch
        {
            System.Text.Json.JsonValueKind.String => element.GetString() is "last" or "all",
            System.Text.Json.JsonValueKind.Array => element.EnumerateArray().All(e => e.ValueKind == System.Text.Json.JsonValueKind.Number && e.TryGetInt32(out var index) && index >= 0 && index < setCount),
            _ => false,
        };
    }
}
