using ProtocoloApp.Api.Features.Push;

namespace ProtocoloApp.UnitTests.Push;

public sealed class ReminderCopyTests
{
    [Theory]
    [InlineData(3, "Atualização em 3 dias: hora das fotos")]
    [InlineData(2, "Atualização em 2 dias: hora das fotos")]
    [InlineData(1, "Atualização amanhã: hora das fotos")]
    [InlineData(0, "Atualização hoje: hora das fotos")]
    public void Update_text_counts_the_days_left(int daysLeft, string body)
    {
        var message = ReminderCopy.Update(daysLeft);

        Assert.Equal("Protocolo", message.Title);
        Assert.Equal(body, message.Body);
        Assert.Equal("/atualizacao", message.Url);
        Assert.Equal("update_photos", message.Tag);
    }

    [Fact]
    public void Update_text_rejects_a_negative_count()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => ReminderCopy.Update(-1));
    }
}
