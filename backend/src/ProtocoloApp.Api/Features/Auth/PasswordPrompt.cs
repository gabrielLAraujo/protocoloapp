namespace ProtocoloApp.Api.Features.Auth;

/// <summary>
/// Where the administrative commands (<c>create-user</c>, <c>set-password</c>) get the password from: never from an argument,
/// which would land in the shell history.
/// <list type="number">
/// <item><c>PROTOCOLOAPP_PASSWORD</c>, when set.</item>
/// <item>An interactive terminal: prompts "Senha: " and "Confirme a senha: ", without echo.</item>
/// <item>Redirected input (a pipe, a test): the first line, silently.</item>
/// </list>
/// </summary>
internal static class PasswordPrompt
{
    public const string Variable = "PROTOCOLOAPP_PASSWORD";

    public const string MismatchMessage = "As senhas não conferem.";

    /// <param name="Password">Null when nothing was provided (the command says what is missing).</param>
    /// <param name="Mismatch">The two typed passwords differ.</param>
    public readonly record struct Result(string? Password, bool Mismatch = false);

    public static Result Read(TextReader stdin, TextWriter output) =>
        Read(stdin, output, Environment.GetEnvironmentVariable(Variable), Console.IsInputRedirected, ReadHidden);

    /// <param name="fromEnvironment">The value of <c>PROTOCOLOAPP_PASSWORD</c>.</param>
    /// <param name="redirected">Whether stdin is not a terminal.</param>
    /// <param name="readHidden">Reads one line without echoing it (only used on a terminal).</param>
    public static Result Read(TextReader stdin, TextWriter output, string? fromEnvironment, bool redirected, Func<string?> readHidden)
    {
        ArgumentNullException.ThrowIfNull(stdin);
        ArgumentNullException.ThrowIfNull(output);
        ArgumentNullException.ThrowIfNull(readHidden);

        if (!string.IsNullOrEmpty(fromEnvironment))
            return new Result(fromEnvironment);

        if (redirected)
            return new Result(stdin.ReadLine());

        output.Write("Senha: ");
        var first = readHidden();
        output.Write("Confirme a senha: ");
        var second = readHidden();

        if (first != second)
            return new Result(null, Mismatch: true);

        return new Result(first);
    }

    /// <summary>Reads a line from the terminal key by key, without echoing it, and moves to the next line when done.</summary>
    private static string? ReadHidden()
    {
        try
        {
            var buffer = new System.Text.StringBuilder();
            while (true)
            {
                var key = Console.ReadKey(intercept: true);
                if (key.Key == ConsoleKey.Enter)
                    break;

                if (key.Key == ConsoleKey.Backspace)
                {
                    if (buffer.Length > 0)
                        buffer.Length--;
                }
                else if (!char.IsControl(key.KeyChar))
                {
                    buffer.Append(key.KeyChar);
                }
            }

            return buffer.ToString();
        }
        catch (InvalidOperationException)
        {
            // No console to read keys from (e.g. a terminal that does not support it): fall back to a visible line.
            return Console.In.ReadLine();
        }
        finally
        {
            Console.WriteLine();
        }
    }
}
