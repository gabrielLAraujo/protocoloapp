using Serilog;

namespace ProtocoloApp.Api.Shared.Http;

/// <summary>One log line per request (Serilog): method, path, status and duration. Never the body nor the query string.</summary>
public static class RequestLoggingSetup
{
    public static IApplicationBuilder UseRequestLogging(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);

        // This host's logger, not the static Log.Logger: with several hosts in one process (tests) each uses its own.
        return app.UseSerilogRequestLogging(options => options.Logger = app.Services.GetRequiredService<Serilog.ILogger>());
    }
}
