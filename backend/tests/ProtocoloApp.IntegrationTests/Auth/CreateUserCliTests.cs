using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Auth;

[Collection("api")]
public sealed class CreateUserCliTests(ApiFactory factory)
{
    [Fact]
    public async Task Creates_user_once()
    {
        var email = AuthApi.NewEmail();
        using var output = new StringWriter();

        var first = await CreateUserCli.RunAsync(factory.Services, email, ApiFactory.DefaultPassword, output);
        var second = await CreateUserCli.RunAsync(factory.Services, email, ApiFactory.DefaultPassword, output);

        Assert.Equal(0, first);
        Assert.NotEqual(0, second);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.Users.CountAsync(u => u.Email == email));
        Assert.DoesNotContain(ApiFactory.DefaultPassword, output.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Created_user_can_log_in()
    {
        var email = AuthApi.NewEmail();
        using var output = new StringWriter();
        await CreateUserCli.RunAsync(factory.Services, email, ApiFactory.DefaultPassword, output);
        using var client = factory.CreateClientWithOwnIp();

        var response = await AuthApi.LoginAsync(client, email, ApiFactory.DefaultPassword);

        Assert.True(response.IsSuccessStatusCode);
    }

    [Fact]
    public async Task Weak_password_is_rejected()
    {
        using var output = new StringWriter();

        var code = await CreateUserCli.RunAsync(factory.Services, AuthApi.NewEmail(), "curta", output);

        Assert.NotEqual(0, code);
    }
}
