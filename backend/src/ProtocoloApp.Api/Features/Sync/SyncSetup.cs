using FluentValidation;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ProtocoloApp.Api.Features.Sync;

public static class SyncSetup
{
    public static IServiceCollection AddSync(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.TryAddSingleton(TimeProvider.System);
        services.AddScoped<SyncHandlerRegistry>();
        services.AddSingleton<IValidator<SyncPushRequest>, SyncPushRequestValidator>();
        return services;
    }

    /// <summary>Makes an entity synchronizable: its changes are accepted by push and returned by pull.</summary>
    public static IServiceCollection AddSyncHandler<THandler>(this IServiceCollection services)
        where THandler : class, ISyncHandler
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddScoped<ISyncHandler, THandler>();
        return services;
    }

    public static void MapSync(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        var group = api.MapGroup("/sync").WithTags("Sync");
        group.MapPost("/push", PushEndpoint.HandleAsync);
        group.MapGet("/pull", PullEndpoint.HandleAsync);
    }
}
