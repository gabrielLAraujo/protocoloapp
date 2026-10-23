using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Features.Updates.Metrics;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Updates;

/// <summary>The cycle of the active protocol.</summary>
public sealed record EnsureUpdateCycleResponse(Guid Id);

/// <summary>Update cycle endpoints, under <c>/api/update-cycles</c>. Answers and photos never go to the logs.</summary>
public static class UpdateEndpoints
{
    public static RouteGroupBuilder MapUpdateEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        var group = api.MapGroup("/update-cycles").WithTags("Updates");
        group.MapPost("/ensure", EnsureAsync);
        group.MapGet("/{id:guid}/metrics", GetMetricsAsync);
        return group;
    }

    /// <summary>
    /// Creates the cycle of the active protocol when it is missing (the device calls it when it finds none after a pull):
    /// 200 with its id, or 204 when there is no active protocol with an update date.
    /// </summary>
    private static async Task<Results<Ok<EnsureUpdateCycleResponse>, NoContent>> EnsureAsync(
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        var cycle = await UpdateCycles.EnsureForActiveProtocolAsync(db, principal.GetUserId(), clock, ct);
        if (cycle is null)
            return TypedResults.NoContent();
        return TypedResults.Ok(new EnsureUpdateCycleResponse(cycle.Id));
    }

    /// <summary>
    /// The fill metrics of the cycle, computed now over <c>period_start</c>..<c>min(period_end, today)</c>; 404 when the cycle
    /// does not exist, is deleted or belongs to someone else.
    /// </summary>
    private static async Task<Results<Ok<UpdateMetricsResponse>, NotFound>> GetMetricsAsync(
        Guid id,
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        IZoneProvider zones,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(zones);

        var metrics = await UpdateMetricsLoader.LoadAsync(db, principal.GetUserId(), id, clock, zones.Zone, ct);
        if (metrics is null)
            return TypedResults.NotFound();
        return TypedResults.Ok(metrics);
    }
}
