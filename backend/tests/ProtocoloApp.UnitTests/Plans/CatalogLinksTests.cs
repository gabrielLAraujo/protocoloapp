using ProtocoloApp.Api.Features.Plans;

namespace ProtocoloApp.UnitTests.Plans;

public sealed class CatalogLinksTests
{
    [Theory]
    [InlineData("EIeI8Vf")]
    [InlineData("cat_keep")]
    [InlineData("cat-remada")]
    [InlineData("a")]
    public void Short_alphanumeric_ids_are_well_formed(string id) => Assert.True(CatalogLinks.IsWellFormed(id));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(" EIeI8Vf")]
    [InlineData("EIeI8Vf\n")]
    [InlineData("has space")]
    [InlineData("semi;colon")]
    [InlineData("../etc")]
    [InlineData("çedilha")]
    public void Blank_padded_or_odd_ids_are_not_well_formed(string? id) => Assert.False(CatalogLinks.IsWellFormed(id));

    [Fact]
    public void Ids_longer_than_the_column_limit_are_not_well_formed()
    {
        Assert.True(CatalogLinks.IsWellFormed(new string('a', 100)));
        Assert.False(CatalogLinks.IsWellFormed(new string('a', 101)));
    }
}
