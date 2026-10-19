using ProtocoloApp.Api.Features.Auth;

namespace ProtocoloApp.IntegrationTests.Auth;

public sealed class PasswordPromptTests
{
    private static string? NoTerminal() => throw new InvalidOperationException("must not read from the terminal");

    [Fact]
    public void Redirected_input_gives_the_first_line_without_printing_anything()
    {
        using var stdin = new StringReader("primeira-senha-123\nsegunda");
        using var output = new StringWriter();

        var result = PasswordPrompt.Read(stdin, output, fromEnvironment: null, redirected: true, NoTerminal);

        Assert.Equal("primeira-senha-123", result.Password);
        Assert.False(result.Mismatch);
        Assert.Equal("", output.ToString());
    }

    [Fact]
    public void Empty_redirected_input_gives_no_password()
    {
        using var stdin = new StringReader("");
        using var output = new StringWriter();

        var result = PasswordPrompt.Read(stdin, output, fromEnvironment: null, redirected: true, NoTerminal);

        Assert.Null(result.Password);
        Assert.False(result.Mismatch);
    }

    [Fact]
    public void The_variable_wins_over_the_terminal_and_stdin()
    {
        using var stdin = new StringReader("de-stdin-1234567");
        using var output = new StringWriter();

        var result = PasswordPrompt.Read(stdin, output, fromEnvironment: "da-variavel-123", redirected: false, NoTerminal);

        Assert.Equal("da-variavel-123", result.Password);
        Assert.Equal("", output.ToString());
    }

    [Fact]
    public void Terminal_asks_twice_and_returns_the_password_when_both_match()
    {
        var typed = new Queue<string?>(["senha-digitada-1", "senha-digitada-1"]);
        using var output = new StringWriter();

        var result = PasswordPrompt.Read(TextReader.Null, output, fromEnvironment: null, redirected: false, typed.Dequeue);

        Assert.Equal("senha-digitada-1", result.Password);
        Assert.False(result.Mismatch);
        Assert.Equal("Senha: Confirme a senha: ", output.ToString());
    }

    [Fact]
    public void Terminal_reports_a_mismatch_and_returns_no_password()
    {
        var typed = new Queue<string?>(["senha-digitada-1", "senha-diferente-2"]);
        using var output = new StringWriter();

        var result = PasswordPrompt.Read(TextReader.Null, output, fromEnvironment: null, redirected: false, typed.Dequeue);

        Assert.True(result.Mismatch);
        Assert.Null(result.Password);
        Assert.DoesNotContain("senha-digitada-1", output.ToString(), StringComparison.Ordinal);
    }
}
