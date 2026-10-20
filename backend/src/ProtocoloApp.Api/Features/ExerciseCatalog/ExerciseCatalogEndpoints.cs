using System.Globalization;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.ExerciseCatalog;

public sealed record CatalogItemResponse(
    string Id,
    string Name,
    IReadOnlyList<string> BodyParts,
    IReadOnlyList<string> TargetMuscles,
    IReadOnlyList<string> Equipments,
    string? GifUrl);

/// <summary><c>Version</c> is also the (quoted) <c>ETag</c> of the response.</summary>
public sealed record CatalogResponse(string Version, IReadOnlyList<CatalogItemResponse> Items);

public static class ExerciseCatalogEndpoints
{
    public static void MapExerciseCatalogEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        api.MapGet("/exercise-catalog", GetAsync).WithTags("ExerciseCatalog");
    }

    private static async Task<Results<Ok<CatalogResponse>, StatusCodeHttpResult>> GetAsync(HttpContext context, AppDbContext db, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(db);

        var stats = await db.CatalogExercises.AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new { Count = g.Count(), Latest = g.Max(e => e.SyncedAt) })
            .FirstOrDefaultAsync(ct);
        var version = stats is null
            ? "0-0"
            : string.Create(CultureInfo.InvariantCulture, $"{stats.Latest.UtcTicks}-{stats.Count}");
        var etag = $"\"{version}\"";

        context.Response.Headers.ETag = etag;
        context.Response.Headers.CacheControl = "private, no-cache";
        if (Matches(context.Request.Headers.IfNoneMatch.ToString(), etag))
            return TypedResults.StatusCode(StatusCodes.Status304NotModified);

        var rows = await db.CatalogExercises.AsNoTracking().ToListAsync(ct);
        var items = rows
            .OrderBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(e => e.Id, StringComparer.Ordinal)
            .Select(e => new CatalogItemResponse(e.Id, e.Name, e.BodyParts, e.TargetMuscles, e.Equipments, e.GifUrl))
            .ToList();
        return TypedResults.Ok(new CatalogResponse(version, items));
    }

    /// <summary>True when the header is <c>*</c> or lists the tag (weak or strong).</summary>
    private static bool Matches(string header, string etag)
    {
        if (string.IsNullOrWhiteSpace(header))
            return false;

        foreach (var part in header.Split(','))
        {
            var tag = part.Trim();
            if (tag == "*" || (tag.StartsWith("W/", StringComparison.Ordinal) ? tag[2..] : tag) == etag)
                return true;
        }

        return false;
    }
}
