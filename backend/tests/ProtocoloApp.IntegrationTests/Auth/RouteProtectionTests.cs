using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Auth;

public sealed class RouteProtectionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly string[] AnonymousRoutes = ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"];

    [Fact]
    public void Every_api_route_requires_auth_unless_explicitly_anonymous()
    {
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText?.StartsWith("/api", StringComparison.OrdinalIgnoreCase) == true)
            .ToList();

        Assert.NotEmpty(endpoints);

        foreach (var endpoint in endpoints)
        {
            var route = endpoint.RoutePattern.RawText!;
            var anonymous = endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null;
            var protectedRoute = endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Count > 0;

            if (AnonymousRoutes.Contains(route, StringComparer.OrdinalIgnoreCase))
                Assert.True(anonymous, $"{route} is on the allowlist and must be AllowAnonymous.");
            else
                Assert.True(protectedRoute && !anonymous, $"{route} must require authorization and is not on the anonymous allowlist.");
        }
    }
}
