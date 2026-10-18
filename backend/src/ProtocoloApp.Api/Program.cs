using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.Api.Shared.Http;
using Scalar.AspNetCore;
using Serilog;
using Serilog.Formatting.Compact;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSerilog((services, logger) => logger
    .ReadFrom.Configuration(builder.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext()
    .WriteTo.Console(new CompactJsonFormatter()));

builder.Services.AddAppProblemDetails();
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

// The API runs behind a reverse proxy (Traefik on Coolify) that terminates TLS and is the only thing reaching it:
// trust its headers for the scheme and the client IP.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

// Lazy on purpose: building the host (OpenAPI generation at build time) must not need a database.
builder.Services.AddDbContext<AppDbContext>(options => options
    .UseNpgsql(builder.Configuration.GetConnectionString("Db"))
    .UseSnakeCaseNamingConvention());

builder.Services.AddAuth(builder.Configuration);
builder.Services.AddAppRateLimiting();
builder.Services.AddSync()
    .AddSyncHandler<DailyCheckinSyncHandler>();

builder.Services.AddOpenApi();
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDbContext>();

var app = builder.Build();

// Administrative command instead of serving: `create-user <email>` (password from PROTOCOLOAPP_PASSWORD or stdin).
if (args is ["create-user", var email])
    return await CreateUserCli.RunAsync(app.Services, email, CreateUserCli.ReadPassword(Console.In), Console.Out);

app.UseForwardedHeaders();
app.UseAppProblemDetails();
app.UseRequestLogging();
app.UseSpaStaticFiles();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

// Liveness: the process is up and Postgres answers. (/health/ready, with the storage check, comes with the files feature.)
app.MapHealthChecks("/health");

// Every /api endpoint needs a logged-in user unless it says AllowAnonymous() (login, refresh, logout). Features map their
// endpoints on this group. (A fallback policy would also gate unknown routes with 401 instead of 404, and /health and the SPA.)
var api = app.MapGroup("/api").RequireAuthorization();
api.MapAuth();
api.MapSync();

app.MapSpaFallback();

app.Run();
return 0;

public partial class Program;
