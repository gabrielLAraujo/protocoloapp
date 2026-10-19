using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Auth;

/// <summary>
/// <c>dotnet ProtocoloApp.Api.dll set-password &lt;email&gt;</c>: resets the password of an existing account (forgotten, or the
/// account is locked out). The password comes from <see cref="PasswordPrompt"/>. Every session of the user is ended (their refresh
/// tokens are revoked; an access token still lives for its few minutes) and a lockout is lifted.
/// </summary>
internal static class SetPasswordCli
{
    /// <returns>0 when changed; 1 when the user does not exist or the e-mail or password is missing or invalid.</returns>
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
            await output.WriteLineAsync($"Informe a senha em {PasswordPrompt.Variable} ou na entrada padrão.");
            return 1;
        }

        await using var scope = services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var user = await users.FindByEmailAsync(email);
        if (user is null)
        {
            await output.WriteLineAsync("Usuário não encontrado.");
            return 1;
        }

        // Validate first and replace the hash in one update: RemovePassword followed by AddPassword would leave the account
        // without a password if the new one were rejected in between.
        var problems = new List<string>();
        foreach (var validator in users.PasswordValidators)
        {
            var validation = await validator.ValidateAsync(users, user, password);
            problems.AddRange(validation.Errors.Select(e => e.Description));
        }

        if (problems.Count > 0)
        {
            await output.WriteLineAsync(string.Join(" ", problems));
            return 1;
        }

        user.PasswordHash = users.PasswordHasher.HashPassword(user, password);
        // Persists the new hash together with a new security stamp.
        var updated = await users.UpdateSecurityStampAsync(user);
        if (!updated.Succeeded)
        {
            await output.WriteLineAsync(string.Join(" ", updated.Errors.Select(e => e.Description)));
            return 1;
        }

        await users.SetLockoutEndDateAsync(user, null);
        await users.ResetAccessFailedCountAsync(user);

        var now = DateTimeOffset.UtcNow;
        await db.RefreshTokens
            .Where(t => t.UserId == user.Id && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now));

        await output.WriteLineAsync("Senha alterada.");
        return 0;
    }
}
