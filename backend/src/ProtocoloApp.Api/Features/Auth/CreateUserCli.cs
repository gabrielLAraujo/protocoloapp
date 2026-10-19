using Microsoft.AspNetCore.Identity;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Auth;

/// <summary>
/// <c>dotnet ProtocoloApp.Api.dll create-user &lt;email&gt;</c>: there is no public sign-up, the account is born on the command
/// line. The password comes from <see cref="PasswordPrompt"/> (variable, prompt or first line of stdin), never from an argument.
/// </summary>
internal static class CreateUserCli
{
    private const string PasswordVariable = PasswordPrompt.Variable;

    /// <returns>0 when created; 1 when the user exists, the e-mail or password is invalid, or no password was given.</returns>
    public static async Task<int> RunAsync(IServiceProvider services, string email, string? password, TextWriter output)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(output);

        if (string.IsNullOrWhiteSpace(email))
        {
            await output.WriteLineAsync("Informe o e-mail.");
            return 1;
        }

        if (string.IsNullOrEmpty(password))
        {
            await output.WriteLineAsync($"Informe a senha em {PasswordVariable} ou na entrada padrão.");
            return 1;
        }

        await using var scope = services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();

        if (await users.FindByEmailAsync(email) is not null)
        {
            await output.WriteLineAsync("Usuário já existe.");
            return 1;
        }

        var result = await users.CreateAsync(new AppUser { UserName = email, Email = email, EmailConfirmed = true }, password);
        if (!result.Succeeded)
        {
            await output.WriteLineAsync(string.Join(" ", result.Errors.Select(e => e.Description)));
            return 1;
        }

        await output.WriteLineAsync("Usuário criado.");
        return 0;
    }
}
