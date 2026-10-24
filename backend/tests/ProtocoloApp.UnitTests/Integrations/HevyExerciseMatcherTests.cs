using System.Text.Json;
using ProtocoloApp.Api.Features.Integrations.Matching;

namespace ProtocoloApp.UnitTests.Integrations;

/// <summary>
/// Runs every case of the shared <c>fixtures/exercise-match-cases.json</c> (the front's exerciseMatch.parity.test.ts runs
/// the same file against the device matcher) and pins the port of <c>exerciseMatch.ts</c> to the front's results.
/// </summary>
public sealed class HevyExerciseMatcherTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly Lazy<List<MatchCase>> Cases = new(() =>
        JsonSerializer.Deserialize<List<MatchCase>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "exercise-match-cases.json")), Json)!);

    public static TheoryData<int> CaseIndexes
    {
        get
        {
            var data = new TheoryData<int>();
            for (var i = 0; i < Cases.Value.Count; i++)
                data.Add(i);
            return data;
        }
    }

    [Fact]
    public void Fixture_has_at_least_ten_cases()
    {
        Assert.True(Cases.Value.Count >= 10, $"Only {Cases.Value.Count} cases.");
    }

    [Theory]
    [MemberData(nameof(CaseIndexes))]
    public void Matches_the_expected_exercise(int index)
    {
        var c = Cases.Value[index];
        var user = c.UserExercises.Select(u => new UserExerciseRef(u.Id, u.Name, u.Aliases, u.CatalogId)).ToList();

        var result = HevyExerciseMatcher.Match(c.Title, user);

        Assert.Equal(c.Expected, result);
    }

    // Same strings and results as the front's exerciseMatch.parity.test.ts (normalizeExerciseName).
    [Theory]
    [InlineData("Elevação Lateral Sentada", "elevacao lateral sentada")]
    [InlineData("Supino inclinado 3x12", "supino inclinado")]
    [InlineData("Rosca direta (parcial) 10kg", "rosca direta")]
    [InlineData("Supino c/ barra", "supino barra")]
    [InlineData("Crucifixo + drop", "crucifixo")]
    public void Normalize_matches_the_front(string name, string expected)
    {
        Assert.Equal(expected, ExerciseWords.Normalize(name));
    }

    [Theory]
    [InlineData("sentada", "sentado")]
    [InlineData("sentados", "sentado")]
    [InlineData("flexoes", "flexao")]
    [InlineData("pernas", "perno")]
    [InlineData("reto", "reto")]
    public void Fold_matches_the_front(string word, string expected)
    {
        Assert.Equal(expected, ExerciseWords.Fold(word));
    }

    [Theory]
    [InlineData("Bench Press (Barbell)", "Bench Press  barra ")]
    [InlineData("Supino (Barra)", "Supino  Barra ")]
    [InlineData("Lateral Raise (Dumbbell)", "Lateral Raise  halter ")]
    [InlineData("Triceps Pushdown (Cable)", "Triceps Pushdown  polia ")]
    [InlineData("Chest Press (Machine)", "Chest Press  maquina ")]
    [InlineData("Squat (Smith Machine)", "Squat  smith ")]
    [InlineData("Barbellish Row", "Barbellish Row")]
    public void Hevy_title_becomes_a_sheet_name_like_the_front(string title, string expected)
    {
        Assert.Equal(expected, ExerciseWords.HevyTitleToSheetName(title));
    }

    [Fact]
    public void Key_sorts_equipment_after_the_core_words()
    {
        Assert.Equal("supino reto barra halter", ExerciseWords.Key("Supino com halteres reto barra"));
        Assert.Equal("supino reto barra", ExerciseWords.FromHevyTitle("Supino Reto (Barbell)"));
    }

    [Fact]
    public void Dictionary_is_embedded_and_complete()
    {
        var entries = ExerciseDictionary.Entries;

        Assert.True(entries.Count >= 100, $"Only {entries.Count} entries.");
        var bench = Assert.Single(entries, e => e.Key == "barbell_bench_press");
        Assert.Equal("barbell", bench.Equipment);
        Assert.Equal("EIeI8Vf", bench.CatalogId);
        Assert.Contains("bench press", bench.Aliases);
    }

    private sealed record MatchCase(string Title, List<UserCase> UserExercises, Guid? Expected, string TsKind);

    private sealed record UserCase(Guid Id, string Name, string[] Aliases, string? CatalogId);
}
