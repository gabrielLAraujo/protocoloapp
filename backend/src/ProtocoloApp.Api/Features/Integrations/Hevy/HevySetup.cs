using ProtocoloApp.Api.Features.Integrations.Secrets;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

public static class HevySetup
{
    /// <summary>
    /// The Hevy integration: <c>Integrations:EncryptionKey</c> (missing or invalid keeps it "not configured", the host still
    /// starts), the secret protector and the Hevy client.
    /// </summary>
    public static IServiceCollection AddHevy(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<IntegrationsOptions>(configuration.GetSection(IntegrationsOptions.Section));
        services.AddSingleton<ISecretProtector, AesGcmSecretProtector>();
        services.AddHevyClient(configuration);
        return services;
    }

    /// <summary>The Hevy endpoints, grouped under <c>/integrations/hevy</c> (tag "Integrations").</summary>
    public static RouteGroupBuilder MapHevy(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        var group = api.MapGroup("/integrations/hevy").WithTags("Integrations");
        group.MapHevyConnectionEndpoints();
        return group;
    }
}
