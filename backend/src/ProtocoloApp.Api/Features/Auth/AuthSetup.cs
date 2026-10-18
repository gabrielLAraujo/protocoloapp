using System.Reflection;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Auth;

public static class AuthSetup
{
    public static IServiceCollection AddAuth(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        // A missing or short key fails the startup. The build-time tools (OpenAPI document generation runs the app's host,
        // `dotnet ef` builds it) have no key and need none: they are exempt from the startup check.
        var options = services.AddOptions<AuthOptions>()
            .Bind(configuration.GetSection(AuthOptions.Section))
            .Validate(
                o => Encoding.UTF8.GetByteCount(o.SigningKey) >= AuthOptions.MinimumSigningKeyBytes,
                $"Auth:SigningKey must have at least {AuthOptions.MinimumSigningKeyBytes} bytes.");
        if (!IsBuildTool())
            options.ValidateOnStart();

        services.AddIdentityCore<AppUser>(options =>
            {
                options.Password.RequiredLength = 10;
                options.Password.RequireDigit = false;
                options.Password.RequireLowercase = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireNonAlphanumeric = false;
                options.User.RequireUniqueEmail = true;
                options.Lockout.MaxFailedAccessAttempts = 5;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
            })
            .AddEntityFrameworkStores<AppDbContext>();

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        // Configured lazily, from the validated options, so the key is only read when the host actually runs.
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<IOptions<AuthOptions>>((jwt, auth) =>
            {
                var settings = auth.Value;
                jwt.MapInboundClaims = false;
                jwt.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = settings.Issuer,
                    ValidateAudience = true,
                    ValidAudience = settings.Audience,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)),
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    ClockSkew = TimeSpan.FromSeconds(30),
                };
            });

        // Secure by default: whatever has no explicit authorization metadata needs a logged-in user.
        // Public endpoints (login, health, SPA, docs) opt out with AllowAnonymous().
        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .Build());

        services.TryAddSingleton(TimeProvider.System);
        services.AddScoped<TokenService>();

        return services;
    }

    private static bool IsBuildTool() =>
        Assembly.GetEntryAssembly()?.GetName().Name is "GetDocument.Insider" or "ef" or "dotnet-ef";

    /// <summary>The id of the logged-in user (the <c>sub</c> claim). Features use it to scope every query to its owner.</summary>
    /// <exception cref="InvalidOperationException">The principal carries no valid <c>sub</c> (not authenticated).</exception>
    public static Guid GetUserId(this ClaimsPrincipal principal)
    {
        ArgumentNullException.ThrowIfNull(principal);

        return Guid.TryParse(principal.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id)
            ? id
            : throw new InvalidOperationException("The principal has no valid 'sub' claim.");
    }
}
