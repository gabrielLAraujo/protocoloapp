using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.App;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Features.Workouts;
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
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    // Numbers are JSON numbers only (the web default also reads them from strings, which makes OpenAPI type every
    // integer as "integer | string" in the generated front types).
    options.SerializerOptions.NumberHandling = JsonNumberHandling.Strict;
});

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

// The Android app's WebView calls the API cross-origin: Capacitor serves it from https://localhost (androidScheme "https")
// or capacitor://localhost. The web build is same-origin and does not need CORS. Override with Cors:AllowedOrigins.
const string AppCorsPolicy = "app";
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? ["https://localhost", "capacitor://localhost"];
builder.Services.AddCors(options => options.AddPolicy(AppCorsPolicy, policy => policy
    .WithOrigins(allowedOrigins)
    .AllowAnyHeader()
    .AllowAnyMethod()
    .SetPreflightMaxAge(TimeSpan.FromMinutes(10))));

builder.Services.AddAuth(builder.Configuration);
builder.Services.AddAppRateLimiting();
builder.Services.AddSync()
    .AddSyncHandler<DailyCheckinSyncHandler>()
    .AddSyncHandler<PlanVersionSyncHandler>()
    .AddSyncHandler<ExerciseSyncHandler>()
    .AddSyncHandler<WorkoutSessionSyncHandler>()
    .AddSyncHandler<SetLogSyncHandler>()
    .AddSyncHandler<ExerciseChangeSyncHandler>()
    .AddSyncHandler<RotationOverrideSyncHandler>();

builder.Services.AddFiles(builder.Configuration);
builder.Services.AddPlanExtraction(builder.Configuration);
builder.Services.AddAppUpdates(builder.Configuration);

builder.Services.AddOpenApi();
// Tags: /health (liveness) runs the "live" checks, /health/ready runs the "ready" ones (Postgres and the storage bucket).
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDbContext>(tags: ["live", FilesSetup.ReadyTag]);

var app = builder.Build();

// Administrative commands instead of serving: `create-user <email>` and `set-password <email>` (the password comes from
// PROTOCOLOAPP_PASSWORD, a terminal prompt or stdin, never from an argument).
if (args is ["create-user" or "set-password", var email])
{
    var input = PasswordPrompt.Read(Console.In, Console.Out);
    if (input.Mismatch)
    {
        await Console.Out.WriteLineAsync(PasswordPrompt.MismatchMessage);
        return 1;
    }

    return args[0] == "create-user"
        ? await CreateUserCli.RunAsync(app.Services, email, input.Password, Console.Out)
        : await SetPasswordCli.RunAsync(app.Services, email, input.Password, Console.Out);
}

app.UseForwardedHeaders();
app.UseAppProblemDetails();
app.UseRequestLogging();
app.UseSpaStaticFiles();
// CORS for /api only, before authentication so that a preflight (no credentials by definition) is answered, not rejected.
app.UseWhen(context => context.Request.Path.StartsWithSegments("/api"), branch => branch.UseCors(AppCorsPolicy));
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

// Liveness: the process is up and Postgres answers. Readiness adds the object storage bucket.
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = check => check.Tags.Contains("live") });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains(FilesSetup.ReadyTag) });

// Every /api endpoint needs a logged-in user unless it says AllowAnonymous() (login, refresh, logout). Features map their
// endpoints on this group. (A fallback policy would also gate unknown routes with 401 instead of 404, and /health and the SPA.)
var api = app.MapGroup("/api").RequireAuthorization();
api.MapAuth();
api.MapSync();
api.MapFiles();
api.MapPlans();
api.MapApp();

app.MapSpaFallback();

app.Run();
return 0;

public partial class Program;
