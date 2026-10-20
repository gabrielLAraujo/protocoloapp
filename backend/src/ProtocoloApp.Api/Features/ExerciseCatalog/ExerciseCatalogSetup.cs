using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ProtocoloApp.Api.Features.ExerciseCatalog;

public static class ExerciseCatalogSetup
{
    /// <summary>The ExerciseDB client and the start-up sync. <c>ExerciseCatalog:Enabled=false</c> keeps the sync from running.</summary>
    public static IServiceCollection AddExerciseCatalog(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<ExerciseCatalogOptions>(configuration.GetSection(ExerciseCatalogOptions.Section));
        services.TryAddSingleton(TimeProvider.System);
        services.AddHttpClient<IExerciseDbClient, ExerciseDbClient>(client =>
            {
                client.BaseAddress = ExerciseDbClient.BaseAddress;
                client.Timeout = TimeSpan.FromSeconds(20);
                client.MaxResponseContentBufferSize = ExerciseDbClient.MaxResponseBytes;
            })
            // Only that host, and never follow a redirect somewhere else.
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });
        // The catalog is a few thousand names: gzip/brotli for this route only (see Program.cs).
        services.AddResponseCompression(options => options.EnableForHttps = true);
        services.AddHostedService<ExerciseCatalogSync>();
        return services;
    }

    public static void MapExerciseCatalog(this IEndpointRouteBuilder api) => api.MapExerciseCatalogEndpoints();
}
