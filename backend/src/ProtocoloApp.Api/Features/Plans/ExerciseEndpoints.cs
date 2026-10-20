using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Features.ExerciseCatalog;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>The user's exercise catalog: list, and edit the muscle group and aliases. Exercises are created by plan activation.</summary>
public static class ExerciseEndpoints
{
    private const int MaxAliases = 20;

    public static void MapExerciseEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        var group = api.MapGroup("/exercises").WithTags("Exercises");
        group.MapGet("/", ListAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
    }

    private static async Task<Ok<IReadOnlyList<ExerciseResponse>>> ListAsync(ClaimsPrincipal principal, AppDbContext db, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);

        var userId = principal.GetUserId();
        var rows = await db.Exercises.AsNoTracking()
            .Where(e => e.UserId == userId && e.DeletedAt == null)
            .OrderBy(e => e.NormalizedName)
            .ToListAsync(ct);
        return TypedResults.Ok<IReadOnlyList<ExerciseResponse>>(rows.Select(PlanMapping.ToResponse).ToList());
    }

    private static async Task<Results<Ok<ExerciseResponse>, NotFound, ValidationProblem>> UpdateAsync(
        Guid id,
        UpdateExerciseRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        var errors = new Dictionary<string, string[]>();
        if (request is null)
        {
            errors["body"] = ["Corpo da requisição inválido."];
        }
        else
        {
            if (!Enum.IsDefined(request.Group))
                errors["group"] = ["Grupo muscular inválido."];
            var aliases = request.Aliases ?? [];
            if (aliases.Length > MaxAliases || aliases.Any(a => !ExerciseNames.IsUsable(ExerciseNames.Normalize(a ?? ""))))
                errors["aliases"] = [$"Até {MaxAliases} apelidos, cada um com um nome válido."];
            if (request.CatalogId is not null
                && (request.CatalogId.Length > CatalogExercise.MaxIdLength
                    || !await db.CatalogExercises.AnyAsync(c => c.Id == request.CatalogId, ct)))
            {
                errors["catalogId"] = ["Exercício do catálogo não encontrado."];
            }
        }

        if (errors.Count > 0)
            return TypedResults.ValidationProblem(errors);

        var userId = principal.GetUserId();
        await using var transaction = await SyncWrites.BeginAsync(db, userId, ct);
        var exercise = await db.Exercises.SingleOrDefaultAsync(e => e.Id == id && e.UserId == userId && e.DeletedAt == null, ct);
        if (exercise is null)
            return TypedResults.NotFound();

        exercise.PrimaryMuscleGroup = request!.Group;
        exercise.Aliases = (request.Aliases ?? []).Select(a => a.Trim()).Distinct(StringComparer.Ordinal).ToArray();
        exercise.CatalogId = request.CatalogId;
        await SyncWrites.StampAsync(db, exercise, userId, clock, ct);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return TypedResults.Ok(PlanMapping.ToResponse(exercise));
    }
}
