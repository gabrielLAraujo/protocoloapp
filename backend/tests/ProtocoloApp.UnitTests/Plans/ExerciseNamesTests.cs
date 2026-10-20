using ProtocoloApp.Api.Features.Plans;

namespace ProtocoloApp.UnitTests.Plans;

public sealed class ExerciseNamesTests
{
    [Fact]
    public void Abbreviated_and_plain_names_match()
    {
        Assert.Equal(
            ExerciseNames.Normalize("Rosca alternada c/ halteres"),
            ExerciseNames.Normalize("rosca alternada halteres"));
        Assert.Equal("rosca alternada halteres", ExerciseNames.Normalize("Rosca alternada c/ halteres"));
    }

    [Theory]
    [InlineData("Rosca alternada com halteres", "rosca alternada halteres")]
    [InlineData("Elevação lateral", "elevacao lateral")]
    [InlineData("  Agachamento   no   Smith!! ", "agachamento smith")]
    [InlineData("Puxada (pegada aberta) - Polia", "puxada pegada aberta polia")]
    [InlineData("Stiff de Barra", "stiff barra")]
    [InlineData("Panturrilha em pé", "panturrilha pe")]
    [InlineData("Rosca Martelo na Corda", "rosca martelo corda")]
    public void Normalizes_case_accents_punctuation_and_filler_words(string input, string expected) =>
        Assert.Equal(expected, ExerciseNames.Normalize(input));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("c/ de")]
    public void Empty_after_normalization_is_empty(string input) =>
        Assert.Equal(string.Empty, ExerciseNames.Normalize(input));

    [Fact]
    public void Different_exercises_stay_different() =>
        Assert.NotEqual(ExerciseNames.Normalize("Supino reto"), ExerciseNames.Normalize("Rosca alternada"));

    [Theory]
    [InlineData("supino reto", true)]
    [InlineData("", false)]
    public void IsUsable_rejects_empty(string normalized, bool expected) =>
        Assert.Equal(expected, ExerciseNames.IsUsable(normalized));

    [Fact]
    public void IsUsable_enforces_the_length_limit()
    {
        Assert.True(ExerciseNames.IsUsable(new string('a', 200)));
        Assert.False(ExerciseNames.IsUsable(new string('a', 201)));
    }
}
