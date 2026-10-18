namespace ProtocoloApp.Api.Features.App;

public static class AppSetup
{
    public static IServiceCollection AddAppUpdates(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        // Not validated at start: without a token the update check answers 503 and the rest of the API works.
        services.Configure<GitHubOptions>(configuration.GetSection(GitHubOptions.Section));
        services.AddMemoryCache();
        services.AddHttpClient<GitHubReleaseClient>(client =>
            {
                client.BaseAddress = new Uri("https://api.github.com/");
                client.Timeout = TimeSpan.FromSeconds(15);
                client.DefaultRequestHeaders.UserAgent.ParseAdd("ProtocoloApp");
                client.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
            })
            // Redirects are followed by hand: the asset API redirects to a signed URL on another host, which must not get the token.
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });
        services.AddScoped<ReleaseCache>();
        return services;
    }
}
