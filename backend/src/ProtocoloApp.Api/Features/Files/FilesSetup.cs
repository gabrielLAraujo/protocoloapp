using System.Reflection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ProtocoloApp.Api.Shared.Storage;

namespace ProtocoloApp.Api.Features.Files;

public static class FilesSetup
{
    /// <summary>Health check tag of the storage probe (<c>/health/ready</c>).</summary>
    public const string ReadyTag = "ready";

    public static IServiceCollection AddFiles(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddOptions<StorageOptions>()
            .Bind(configuration.GetSection(StorageOptions.Section))
            .Validate(
                o => !string.IsNullOrWhiteSpace(o.AccountId) && !string.IsNullOrWhiteSpace(o.AccessKeyId)
                    && !string.IsNullOrWhiteSpace(o.SecretAccessKey) && !string.IsNullOrWhiteSpace(o.Bucket),
                "R2:AccountId, R2:AccessKeyId, R2:SecretAccessKey and R2:Bucket are required.")
            .Validate(o => o.HasValidServiceUrl, "R2:ServiceUrl must be an absolute https URL, or an http URL on localhost, 127.0.0.1 or ::1.");

        services.TryAddSingleton(TimeProvider.System);
        // The options are read when the storage is first built. The startup check below builds it, so a missing setting
        // fails the start, except when something else (a test fake) is registered as IFileStorage, or a build tool runs.
        services.TryAddSingleton<IFileStorage, R2FileStorage>();
        if (!IsBuildTool())
            services.AddHostedService<StorageStartupCheck>();

        services.AddHealthChecks().AddCheck<StorageHealthCheck>("storage", failureStatus: null, tags: [ReadyTag], timeout: TimeSpan.FromSeconds(5));
        return services;
    }

    private static bool IsBuildTool() =>
        Assembly.GetEntryAssembly()?.GetName().Name is "GetDocument.Insider" or "ef" or "dotnet-ef";

    /// <summary>Resolving the storage builds it from the validated options: misconfiguration stops the host at start.</summary>
    private sealed class StorageStartupCheck(IFileStorage storage) : IHostedService
    {
        public Task StartAsync(CancellationToken cancellationToken)
        {
            _ = storage;
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class StorageHealthCheck(IFileStorage storage) : IHealthCheck
    {
        public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken cancellationToken = default) =>
            await storage.CanReachBucketAsync(cancellationToken)
                ? HealthCheckResult.Healthy()
                : HealthCheckResult.Unhealthy("The storage bucket is not reachable.");
    }
}
