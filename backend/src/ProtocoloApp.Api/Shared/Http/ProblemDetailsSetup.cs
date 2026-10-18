using System.Diagnostics;

namespace ProtocoloApp.Api.Shared.Http;

/// <summary>Every error leaves the API as problem details (RFC 9457): unhandled exceptions, and empty 4xx/5xx responses such as unknown routes.</summary>
public static class ProblemDetailsSetup
{
    public static IServiceCollection AddAppProblemDetails(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddProblemDetails(options => options.CustomizeProblemDetails = context =>
            context.ProblemDetails.Extensions.TryAdd("traceId", Activity.Current?.Id ?? context.HttpContext.TraceIdentifier));
        services.AddExceptionHandler<GlobalExceptionHandler>();

        return services;
    }

    public static IApplicationBuilder UseAppProblemDetails(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.UseExceptionHandler();
        app.UseStatusCodePages();

        return app;
    }
}
