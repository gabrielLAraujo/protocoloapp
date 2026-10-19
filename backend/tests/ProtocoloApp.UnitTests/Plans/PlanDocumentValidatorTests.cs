using ProtocoloApp.Api.Features.Plans;

namespace ProtocoloApp.UnitTests.Plans;

public sealed class PlanDocumentValidatorTests
{
    private static readonly WorkoutDocumentValidator Workout = new();
    private static readonly ProtocolDocumentValidator Protocol = new();

    private const string ValidWorkout = """
        {
          "rotation": { "type": "sequence", "items": ["A", "B", "off"] },
          "days": [
            { "key": "A", "name": "Pernas", "notes": null, "exercises": [
              { "key": "A1", "exerciseId": null, "name": "Leg 45",
                "sets": [ { "repsMin": 8, "repsMax": 12, "technique": null } ],
                "restSeconds": 90, "restSequence": null, "technique": null, "supersetWith": null } ] },
            { "key": "B", "name": "Costas", "notes": null, "exercises": [
              { "key": "B1", "exerciseId": null, "name": "Puxada",
                "sets": [ { "repsMin": 10, "repsMax": 10, "technique": "drop" } ],
                "restSeconds": null, "restSequence": [45, 30, 15], "technique": null, "supersetWith": null } ] }
          ]
        }
        """;

    private static WorkoutDocument Doc(string json = ValidWorkout) => PlanDocuments.Deserialize<WorkoutDocument>(json)!;

    private static List<string> Errors(WorkoutDocument doc) =>
        Workout.Validate(doc).Errors.Select(e => e.PropertyName).Distinct().ToList();

    [Fact]
    public void Valid_workout_has_no_errors() => Assert.Empty(Errors(Doc()));

    [Fact]
    public void Workout_over_the_size_caps_is_an_error_on_each_list()
    {
        var set = new PlannedSetDto { RepsMin = 8, RepsMax = 12 };
        var bigExercise = new PlannedExerciseDto { Key = "e0", Name = "Exercício fictício", Sets = Enumerable.Repeat(set, PlanDocumentRules.MaxSetsPerExercise + 1).ToList() };
        var crowdedDay = new WorkoutDayDto
        {
            Key = "d0",
            Name = "Dia",
            Exercises = Enumerable.Range(0, PlanDocumentRules.MaxExercisesPerDay + 1)
                .Select(j => j == 0 ? bigExercise : new PlannedExerciseDto { Key = $"e{j}", Name = "Exercício fictício", Sets = [set] })
                .ToList(),
        };
        var days = Enumerable.Range(0, PlanDocumentRules.MaxDays + 1)
            .Select(i => i == 0 ? crowdedDay : new WorkoutDayDto { Key = $"d{i}", Name = "Dia", Exercises = [] })
            .ToList();
        var doc = Doc() with { Days = days, Rotation = new RotationDto { Type = RotationDto.Sequence, Items = ["d0"] } };

        var errors = Errors(doc);

        Assert.Contains("days", errors);
        Assert.Contains("days[0].exercises", errors);
        Assert.Contains("days[0].exercises[0].sets", errors);
        var atTheCap = Enumerable.Range(0, PlanDocumentRules.MaxDays)
            .Select(i => new WorkoutDayDto { Key = $"d{i}", Name = "Dia", Exercises = [new PlannedExerciseDto { Key = "e", Name = "n", Sets = [set] }] })
            .ToList();
        Assert.Empty(Errors(doc with { Days = atTheCap }));
    }

    [Fact]
    public void Protocol_over_the_size_caps_is_an_error_on_each_list()
    {
        var food = new MealItemDto { Food = "Alimento fictício", Alternatives = [] };
        var meals = Enumerable.Range(0, PlanDocumentRules.MaxMealsOrItems + 1)
            .Select(i => new MealDto { Key = $"m{i}", Label = "Refeição", Items = i == 0 ? Enumerable.Repeat(food, PlanDocumentRules.MaxMealsOrItems + 1).ToList() : [food] })
            .ToList();
        var items = Enumerable.Range(0, PlanDocumentRules.MaxMealsOrItems + 1)
            .Select(i => new ProtocolItemDto { Key = $"i{i}", Category = "supplement", Name = "Item fictício", Timing = "any", Schedule = new ScheduleDto { Type = "daily" } })
            .ToList();

        var errors = Protocol.Validate(new ProtocolDocument { Meals = meals, Items = items }).Errors.Select(e => e.PropertyName).ToList();

        Assert.Contains("meals", errors);
        Assert.Contains("meals[0].items", errors);
        Assert.Contains("items", errors);
        Assert.DoesNotContain("meals[1].items", errors);
    }

    [Fact]
    public void Rotation_item_with_unknown_day_key_is_an_error()
    {
        var doc = Doc(ValidWorkout.Replace("\"items\": [\"A\", \"B\", \"off\"]", "\"items\": [\"A\", \"Z\", \"off\"]", StringComparison.Ordinal));

        Assert.Contains("rotation.items", Errors(doc));
    }

    [Fact]
    public void Empty_rotation_is_an_error()
    {
        var doc = Doc(ValidWorkout.Replace("\"items\": [\"A\", \"B\", \"off\"]", "\"items\": []", StringComparison.Ordinal));

        Assert.Contains("rotation.items", Errors(doc));
    }

    [Fact]
    public void Missing_rotation_is_an_error()
    {
        var doc = Doc() with { Rotation = null };

        Assert.Contains("rotation", Errors(doc));
    }

    [Fact]
    public void Workout_without_days_is_an_error()
    {
        var doc = Doc() with { Days = [] };

        Assert.Contains("days", Errors(doc));
    }

    [Fact]
    public void Duplicate_day_keys_are_an_error()
    {
        var doc = Doc(ValidWorkout.Replace("\"key\": \"B\", \"name\"", "\"key\": \"A\", \"name\"", StringComparison.Ordinal));

        Assert.Contains("days", Errors(doc));
    }

    [Fact]
    public void Fixed_weekdays_must_cover_all_seven_days()
    {
        const string json = """
            { "rotation": { "type": "fixed_weekdays",
                "map": { "mon": "A", "tue": "B", "wed": "off", "thu": "A", "fri": "B", "sat": "off" } },
              "days": [
                { "key": "A", "name": "A", "notes": null, "exercises": [ { "key": "A1", "name": "X", "sets": [ { "repsMin": 8, "repsMax": 10 } ] } ] },
                { "key": "B", "name": "B", "notes": null, "exercises": [ { "key": "B1", "name": "Y", "sets": [ { "repsMin": 8, "repsMax": 10 } ] } ] } ] }
            """;

        Assert.Contains("rotation.map", Errors(Doc(json)));
    }

    [Fact]
    public void Fixed_weekdays_covering_the_week_is_valid()
    {
        const string json = """
            { "rotation": { "type": "fixed_weekdays",
                "map": { "mon": "A", "tue": "B", "wed": "off", "thu": "A", "fri": "B", "sat": "off", "sun": "off" } },
              "days": [
                { "key": "A", "name": "A", "notes": null, "exercises": [ { "key": "A1", "name": "X", "sets": [ { "repsMin": 8, "repsMax": 10 } ] } ] },
                { "key": "B", "name": "B", "notes": null, "exercises": [ { "key": "B1", "name": "Y", "sets": [ { "repsMin": 8, "repsMax": 10 } ] } ] } ] }
            """;

        Assert.Empty(Errors(Doc(json)));
    }

    [Fact]
    public void Fixed_weekdays_with_unknown_day_key_is_an_error()
    {
        const string json = """
            { "rotation": { "type": "fixed_weekdays",
                "map": { "mon": "A", "tue": "Q", "wed": "off", "thu": "A", "fri": "A", "sat": "off", "sun": "off" } },
              "days": [
                { "key": "A", "name": "A", "notes": null, "exercises": [ { "key": "A1", "name": "X", "sets": [ { "repsMin": 8, "repsMax": 10 } ] } ] } ] }
            """;

        Assert.Contains("rotation.map", Errors(Doc(json)));
    }

    [Fact]
    public void Unknown_rotation_type_is_an_error()
    {
        var doc = Doc(ValidWorkout.Replace("\"sequence\"", "\"weekly\"", StringComparison.Ordinal));

        Assert.Contains("rotation.type", Errors(doc));
    }

    [Fact]
    public void Reps_min_above_reps_max_is_an_error()
    {
        var doc = Doc(ValidWorkout.Replace("\"repsMin\": 8, \"repsMax\": 12", "\"repsMin\": 12, \"repsMax\": 8", StringComparison.Ordinal));

        Assert.Contains("days[0].exercises[0].sets[0]", Errors(doc));
    }

    [Fact]
    public void Exercise_without_sets_is_an_error()
    {
        var doc = Doc(ValidWorkout.Replace(
            "\"sets\": [ { \"repsMin\": 8, \"repsMax\": 12, \"technique\": null } ]", "\"sets\": []", StringComparison.Ordinal));

        Assert.Contains("days[0].exercises[0].sets", Errors(doc));
    }

    [Theory]
    [InlineData("\"restSeconds\": 90", "\"restSeconds\": 901")]
    [InlineData("\"restSeconds\": 90", "\"restSeconds\": -1")]
    [InlineData("\"restSequence\": [45, 30, 15]", "\"restSequence\": [45, 1000]")]
    [InlineData("\"restSequence\": [45, 30, 15]", "\"restSequence\": []")]
    public void Rest_out_of_range_is_an_error(string from, string to)
    {
        var doc = Doc(ValidWorkout.Replace(from, to, StringComparison.Ordinal));

        Assert.Contains(Errors(doc), e => e.Contains("rest", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Minimal_protocol_with_null_update_date_is_valid()
    {
        var doc = PlanDocuments.Deserialize<ProtocolDocument>(
            """{ "phaseName": null, "updateDate": null, "billingDate": null, "meals": [], "items": [], "cardio": null, "guidelines": [], "trainingSplitNote": null }""")!;

        Assert.Empty(Protocol.Validate(doc).Errors);
    }

    [Fact]
    public void Full_protocol_is_valid()
    {
        var doc = PlanDocuments.Deserialize<ProtocolDocument>("""
            { "phaseName": "Fase exemplo", "updateDate": "2026-11-15", "billingDate": "2026-11-29",
              "meals": [ { "key": "meal_1", "label": "REF 1", "items": [ { "food": "aveia", "grams": 90, "alternatives": [] } ], "notes": null } ],
              "items": [ { "key": "it_1", "category": "supplement", "name": "Creatina", "doseText": "6 g", "timing": "any", "schedule": { "type": "daily" } },
                         { "key": "it_2", "category": "supplement", "name": "Item B", "doseText": "1 cp", "timing": "with_meal:meal_1", "schedule": { "type": "weekdays", "days": ["mon", "fri"] } } ],
              "cardio": { "sessionsPerWeek": 7, "durationMin": 15, "intensity": "HIIT", "preferredTime": "manha" },
              "guidelines": [ { "kind": "water_min_l", "value": 4.2 }, { "kind": "text", "text": "Exemplo." } ],
              "trainingSplitNote": null }
            """)!;

        Assert.Empty(Protocol.Validate(doc).Errors);
    }

    [Fact]
    public void Protocol_with_duplicate_item_keys_and_bad_category_is_invalid()
    {
        var doc = PlanDocuments.Deserialize<ProtocolDocument>("""
            { "meals": [],
              "items": [ { "key": "it_1", "category": "supplement", "name": "A", "doseText": "1", "timing": "any", "schedule": { "type": "daily" } },
                         { "key": "it_1", "category": "candy", "name": "B", "doseText": "1", "timing": "any", "schedule": { "type": "daily" } } ] }
            """)!;

        var errors = Protocol.Validate(doc).Errors.Select(e => e.PropertyName).ToList();

        Assert.Contains("items", errors);
        Assert.Contains("items[1].category", errors);
    }

    [Fact]
    public void Billing_before_update_is_valid()
    {
        var doc = PlanDocuments.Deserialize<ProtocolDocument>("""{ "updateDate": "2026-11-15", "billingDate": "2026-11-01" }""")!;

        Assert.Empty(Protocol.Validate(doc).Errors);
    }

    [Theory]
    [InlineData("""{ "meals": null, "items": null, "guidelines": null }""")]
    [InlineData("""{ "meals": [null], "items": [null], "guidelines": [null] }""")]
    [InlineData("""{ "meals": [ { "key": "m", "items": null } ], "items": [ { "key": "a", "category": "supplement", "name": "x", "schedule": null } ] }""")]
    public void Protocol_with_explicit_nulls_does_not_throw(string json)
    {
        var doc = PlanDocuments.Deserialize<ProtocolDocument>(json)!;

        var ex = Record.Exception(() => Protocol.Validate(doc));

        Assert.Null(ex);
    }

    [Fact]
    public void Protocol_item_with_null_schedule_is_an_error()
    {
        var doc = PlanDocuments.Deserialize<ProtocolDocument>(
            """{ "items": [ { "key": "a", "category": "supplement", "name": "x", "timing": "any", "schedule": null } ] }""")!;

        Assert.Contains("items[0].schedule", Protocol.Validate(doc).Errors.Select(e => e.PropertyName));
    }

    [Theory]
    [InlineData("""{ "rotation": null, "days": null }""", "days")]
    [InlineData("""{ "rotation": { "type": "sequence", "items": ["A"] }, "days": [null] }""", "days[0]")]
    [InlineData("""{ "rotation": { "type": "sequence", "items": ["A"] }, "days": [ { "key": "A", "exercises": [ { "key": "A1", "name": "x", "sets": null } ] } ] }""", "days[0].exercises[0].sets")]
    [InlineData("""{ "rotation": { "type": "sequence", "items": ["A"] }, "days": [ { "key": "A", "exercises": [ { "key": "A1", "name": "x", "sets": [null] } ] } ] }""", "days[0].exercises[0].sets[0]")]
    public void Workout_with_explicit_nulls_reports_errors_without_throwing(string json, string expectedPath)
    {
        var doc = PlanDocuments.Deserialize<WorkoutDocument>(json)!;

        var errors = Workout.Validate(doc).Errors.Select(e => e.PropertyName).ToList();

        Assert.Contains(expectedPath, errors);
    }

    [Fact]
    public void Day_with_null_exercises_is_treated_as_empty()
    {
        var doc = PlanDocuments.Deserialize<WorkoutDocument>(
            """{ "rotation": { "type": "sequence", "items": ["A"] }, "days": [ { "key": "A", "exercises": null } ] }""")!;

        Assert.Empty(Errors(doc));
    }

    [Fact]
    public void TryRead_reports_a_null_number_as_an_error_instead_of_throwing()
    {
        using var json = System.Text.Json.JsonDocument.Parse(
            """{ "days": [ { "key": "A", "exercises": [ { "key": "A1", "name": "x", "sets": [ { "repsMin": null, "repsMax": 5 } ] } ] } ] }""");

        var ok = PlanDocuments.TryRead<WorkoutDocument>(json.RootElement, out var doc, out var errors);

        Assert.False(ok);
        Assert.Null(doc);
        Assert.NotEmpty(errors);
        Assert.StartsWith("days", errors[0], StringComparison.Ordinal);
    }

    [Fact]
    public void TryRead_rejects_a_non_object_root_and_accepts_a_valid_document()
    {
        using var array = System.Text.Json.JsonDocument.Parse("[]");
        using var valid = System.Text.Json.JsonDocument.Parse(ValidWorkout);

        Assert.False(PlanDocuments.TryRead<WorkoutDocument>(array.RootElement, out _, out var errors));
        Assert.Equal("document", Assert.Single(errors));
        Assert.True(PlanDocuments.TryRead<WorkoutDocument>(valid.RootElement, out var doc, out var none));
        Assert.NotNull(doc);
        Assert.Empty(none);
    }
}
