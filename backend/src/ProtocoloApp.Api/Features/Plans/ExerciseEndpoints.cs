using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Auth;
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
        group.MapPut("/{id:guid}/catalog", SetCatalogAsync);
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
        await SyncWrites.StampAsync(db, exercise, userId, clock, ct);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return TypedResults.Ok(PlanMapping.ToResponse(exercise));
    }

    /// <summary>Links the exercise to a catalog entry (media), or clears the link with null. Group and aliases are untouched.</summary>
    private static async Task<Results<Ok<ExerciseResponse>, NotFound, ValidationProblem>> SetCatalogAsync(
        Guid id,
        SetExerciseCatalogRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        if (request is null)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["body"] = ["Corpo da requisição inválido."] });

        // Unknown ids are refused only once the catalog is synced; before that a well-formed id is accepted (CatalogLinks).
        var catalogId = request.CatalogId;
        if (catalogId is not null && !(await CatalogLinks.KeptAsync(db, [catalogId], ct)).Contains(catalogId))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["catalogId"] = ["Exercício do catálogo não encontrado."] });
        }

        var userId = principal.GetUserId();
        await using var transaction = await SyncWrites.BeginAsync(db, userId, ct);
        var exercise = await db.Exercises.SingleOrDefaultAsync(e => e.Id == id && e.UserId == userId && e.DeletedAt == null, ct);
        if (exercise is null)
            return TypedResults.NotFound();

        exercise.CatalogId = catalogId;
        await SyncWrites.StampAsync(db, exercise, userId, clock, ct);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return TypedResults.Ok(PlanMapping.ToResponse(exercise));
    }
}
