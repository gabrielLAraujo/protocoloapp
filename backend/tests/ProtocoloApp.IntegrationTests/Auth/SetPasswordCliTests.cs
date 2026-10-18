using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Auth;

[Collection("api")]
public sealed class SetPasswordCliTests(ApiFactory factory)
{
    private const string NewPassword = "Outra-senha-456";

    [Fact]
    public async Task New_password_works_and_the_old_one_does_not()
    {
        var email = AuthApi.NewEmail();
        await factory.CreateUserAsync(email);
        using var output = new StringWriter();

        var code = await SetPasswordCli.RunAsync(factory.Services, email, NewPassword, output);

        Assert.Equal(0, code);
        Assert.Contains("Senha alterada.", output.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain(NewPassword, output.ToString(), StringComparison.Ordinal);
        using var client = factory.CreateClientWithOwnIp();
        Assert.True((await AuthApi.LoginAsync(client, email, NewPassword)).IsSuccessStatusCode);
        Assert.False((await AuthApi.LoginAsync(client, email, ApiFactory.DefaultPassword)).IsSuccessStatusCode);
    }

    [Fact]
    public async Task Unknown_user_is_reported()
    {
        using var output = new StringWriter();

        var code = await SetPasswordCli.RunAsync(factory.Services, AuthApi.NewEmail(), NewPassword, output);

        Assert.Equal(1, code);
        Assert.Contains("Usuário não encontrado.", output.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Weak_password_is_rejected_and_the_old_one_keeps_working()
    {
        var email = AuthApi.NewEmail();
        await factory.CreateUserAsync(email);
        using var output = new StringWriter();

        var code = await SetPasswordCli.RunAsync(factory.Services, email, "curta", output);

        Assert.Equal(1, code);
        using var client = factory.CreateClientWithOwnIp();
        Assert.True((await AuthApi.LoginAsync(client, email, ApiFactory.DefaultPassword)).IsSuccessStatusCode);
    }

    [Fact]
    public async Task Missing_password_is_reported()
    {
        var email = AuthApi.NewEmail();
        await factory.CreateUserAsync(email);
        using var output = new StringWriter();

        var code = await SetPasswordCli.RunAsync(factory.Services, email, null, output);

        Assert.Equal(1, code);
        Assert.Contains(PasswordPrompt.Variable, output.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Refresh_tokens_of_that_user_are_revoked_and_other_users_keep_theirs()
    {
        var email = AuthApi.NewEmail();
        var other = AuthApi.NewEmail();
        await factory.CreateUserAsync(email);
        await factory.CreateUserAsync(other);
        using var client = factory.CreateClientWithOwnIp();
        var session = await AuthApi.LoginOkAsync(client, email, ApiFactory.DefaultPassword);
        var otherSession = await AuthApi.LoginOkAsync(client, other, ApiFactory.DefaultPassword);
        using var output = new StringWriter();

        await SetPasswordCli.RunAsync(factory.Services, email, NewPassword, output);

        Assert.False((await AuthApi.RefreshAsync(client, session.RefreshToken)).IsSuccessStatusCode);
        Assert.True((await AuthApi.RefreshAsync(client, otherSession.RefreshToken)).IsSuccessStatusCode);
    }

    [Fact]
    public async Task A_locked_out_account_can_log_in_again()
    {
        var email = AuthApi.NewEmail();
        await factory.CreateUserAsync(email);
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.Identity.UserManager<AppUser>>();
            var user = (await users.FindByEmailAsync(email))!;
            await users.SetLockoutEndDateAsync(user, DateTimeOffset.UtcNow.AddMinutes(15));
            await users.AccessFailedAsync(user);
        }

        using var output = new StringWriter();
        await SetPasswordCli.RunAsync(factory.Services, email, NewPassword, output);

        await using var check = factory.Services.CreateAsyncScope();
        var stored = await check.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().SingleAsync(u => u.Email == email);
        Assert.Null(stored.LockoutEnd);
        Assert.Equal(0, stored.AccessFailedCount);
        using var client = factory.CreateClientWithOwnIp();
        Assert.True((await AuthApi.LoginAsync(client, email, NewPassword)).IsSuccessStatusCode);
    }
}
