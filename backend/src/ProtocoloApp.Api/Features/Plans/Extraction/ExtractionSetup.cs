using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ProtocoloApp.Api.Features.Plans.Extraction;

public static class ExtractionSetup
{
    public static IServiceCollection AddPlanExtraction(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.AddOptions<AnthropicOptions>().Bind(configuration.GetSection(AnthropicOptions.Section));
        services.TryAddSingleton(TimeProvider.System);
        // The per-attempt timeout is AnthropicOptions.Timeout (enforced by the client), not the HttpClient's.
        services.AddHttpClient<AnthropicClient>(client => client.Timeout = System.Threading.Timeout.InfiniteTimeSpan);
        services.AddTransient<IPlanExtractor, PlanExtractor>();
        return services;
    }
}
