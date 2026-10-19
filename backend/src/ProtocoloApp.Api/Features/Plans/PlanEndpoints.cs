using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.Api.Shared.Storage;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>
/// Import of a protocol or workout PDF into a draft, its review (<c>GET</c>/<c>PUT</c>) and activation. Rows of other users
/// are 404. The content of documents is never logged.
/// </summary>
public static class PlanEndpoints
{
    public static void MapPlanEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        var group = api.MapGroup("/plans").WithTags("Plans");
        group.MapPost("/import", ImportAsync);
        group.MapGet("/", ListAsync);
        group.MapGet("/{id:guid}", GetAsync);
        group.MapPut("/{id:guid}", UpdateAsync);
        group.MapPost("/{id:guid}/activate", ActivateAsync);
    }

    private static async Task<Results<Created<PlanVersionResponse>, NotFound, ValidationProblem, ProblemHttpResult>> ImportAsync(
        ImportPlanRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        IFileStorage storage,
        IPlanExtractor extractor,
        IOptions<AnthropicOptions> options,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(storage);
        ArgumentNullException.ThrowIfNull(extractor);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(clock);

        if (request is null || !Enum.IsDefined(request.Kind))
            return Invalid("kind", "Tipo de plano inválido.");

        var userId = principal.GetUserId();
        var file = await db.Files.AsNoTracking().SingleOrDefaultAsync(f => f.Id == request.FileId && f.UserId == userId, ct);
        if (file is null)
            return TypedResults.NotFound();

        var expected = request.Kind == PlanKind.Protocol ? FileKind.ProtocolPdf : FileKind.WorkoutPdf;
        if (file.Kind != expected)
            return Invalid("fileId", "O arquivo não é do tipo esperado para este plano.");
        if (file.Status != FileStatus.Confirmed)
            return Problem(StatusCodes.Status409Conflict, "Conflito", "O envio do arquivo ainda não foi confirmado.");

        var known = (await db.Exercises.AsNoTracking()
                .Where(e => e.UserId == userId && e.DeletedAt == null)
                .Select(e => new { e.Id, e.Name, e.PrimaryMuscleGroup })
                .ToListAsync(ct))
            .Select(e => new ExerciseHint(e.Id, e.Name, e.PrimaryMuscleGroup))
            .ToList();

        // One cap on the whole import, on top of the extractor's per-attempt timeout.
        using var total = CancellationTokenSource.CreateLinkedTokenSource(ct);
        total.CancelAfter(options.Value.TotalTimeout);

        PlanExtractionResult result;
        try
        {
            Stream pdf;
            try
            {
                pdf = await storage.OpenReadAsync(file.StorageKey, total.Token);
            }
            catch (FileNotFoundException)
            {
                return Problem(StatusCodes.Status409Conflict, "Conflito", "O arquivo não foi encontrado no armazenamento.");
            }

            await using (pdf)
                result = await extractor.ExtractAsync(request.Kind, pdf, known, total.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            result = PlanExtractionResult.Failure(PlanExtractionResult.Timeout);
        }

        if (result.Error == PlanExtractionResult.Unavailable)
            return Problem(StatusCodes.Status503ServiceUnavailable, "Importação indisponível");
        if (result.Error == PlanExtractionResult.TooLarge)
            return Problem(StatusCodes.Status413PayloadTooLarge, "PDF grande demais (máx. 20 MB)");

        var plan = new PlanVersion
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Kind = request.Kind,
            Status = PlanStatus.Draft,
            SourceFileId = file.Id,
        };
        if (result.IsSuccess)
        {
            plan.Document = result.Document!;
            plan.RawExtraction = result.Raw;
            plan.LowConfidence = [.. result.LowConfidence];
            plan.NewExercises = PlanMapping.WriteNewExercises(result.NewExercises);
        }
        else
        {
            // timeout, invalid_extraction, too_long: an empty draft the user can fill in.
            plan.ExtractionError = result.Error;
            plan.Document = JsonDocument.Parse(EmptyDocument(request.Kind).GetRawText());
        }

        await using (var transaction = await SyncWrites.BeginAsync(db, userId, ct))
        {
            await SyncWrites.StampAsync(db, plan, userId, clock, ct);
            db.PlanVersions.Add(plan);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }

        return TypedResults.Created($"/api/plans/{plan.Id}", PlanMapping.ToResponse(plan, null));
    }

    private static async Task<Results<Ok<IReadOnlyList<PlanVersionSummary>>, ValidationProblem>> ListAsync(
        string? kind,
        string? status,
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);

        PlanKind? kindFilter = null;
        PlanStatus? statusFilter = null;
        var errors = new Dictionary<string, string[]>();
        if (!string.IsNullOrEmpty(kind))
        {
            if (Enum.TryParse<PlanKind>(kind, ignoreCase: true, out var parsed) && Enum.IsDefined(parsed))
                kindFilter = parsed;
            else
                errors["kind"] = ["Tipo de plano inválido."];
        }

        if (!string.IsNullOrEmpty(status))
        {
            if (Enum.TryParse<PlanStatus>(status, ignoreCase: true, out var parsed) && Enum.IsDefined(parsed))
                statusFilter = parsed;
            else
                errors["status"] = ["Situação inválida."];
        }

        if (errors.Count > 0)
            return TypedResults.ValidationProblem(errors);

        var userId = principal.GetUserId();
        var query = db.PlanVersions.AsNoTracking().Where(p => p.UserId == userId && p.DeletedAt == null);
        if (kindFilter is { } k)
            query = query.Where(p => p.Kind == k);
        if (statusFilter is { } s)
            query = query.Where(p => p.Status == s);

        var rows = await query.OrderByDescending(p => p.CreatedAt).Take(200)
            .Select(p => new PlanVersionSummary(p.Id, p.Kind, p.Status, p.CreatedAt, p.ActivatedAt, p.SourceFileId, p.ExtractionError))
            .ToListAsync(ct);
        return TypedResults.Ok<IReadOnlyList<PlanVersionSummary>>(rows);
    }

    private static async Task<Results<Ok<PlanVersionResponse>, NotFound>> GetAsync(
        Guid id,
        ClaimsPrincipal principal,
        AppDbContext db,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);

        var userId = principal.GetUserId();
        var plan = await db.PlanVersions.AsNoTracking().SingleOrDefaultAsync(p => p.Id == id && p.UserId == userId && p.DeletedAt == null, ct);
        if (plan is null)
            return TypedResults.NotFound();

        PlanDiffDto? diff = null;
        if (plan.Status == PlanStatus.Draft)
        {
            var active = await db.PlanVersions.AsNoTracking()
                .SingleOrDefaultAsync(p => p.UserId == userId && p.Kind == plan.Kind && p.Status == PlanStatus.Active && p.DeletedAt == null, ct);
            if (active is not null)
                diff = PlanDiff.Compute(active.Document.RootElement, plan.Document.RootElement);
        }

        return TypedResults.Ok(PlanMapping.ToResponse(plan, diff));
    }

    private static async Task<Results<Ok<PlanVersionResponse>, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(
        Guid id,
        UpdatePlanRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        if (request is null)
            return Invalid("body", "Corpo da requisição inválido.");

        var userId = principal.GetUserId();
        await using var transaction = await SyncWrites.BeginAsync(db, userId, ct);
        var plan = await db.PlanVersions.SingleOrDefaultAsync(p => p.Id == id && p.UserId == userId && p.DeletedAt == null, ct);
        if (plan is null)
            return TypedResults.NotFound();
        if (plan.Status != PlanStatus.Draft)
            return Problem(StatusCodes.Status409Conflict, "Conflito", "Só um rascunho pode ser editado.");

        // A draft only has to be readable: the review screen fills the gaps, activation checks the rest.
        var normalized = Normalize(plan.Kind, request.Document, out var errors);
        if (normalized is null)
            return TypedResults.ValidationProblem(errors);

        JsonDocument? newExercises = plan.NewExercises;
        if (request.NewExercises is { } suggestions)
        {
            var problems = new Dictionary<string, string[]>();
            for (var i = 0; i < suggestions.Count; i++)
            {
                var suggestion = suggestions[i];
                if (suggestion is null || !ExerciseNames.IsUsable(ExerciseNames.Normalize(suggestion.Name ?? "")))
                    problems[$"newExercises[{i}].name"] = ["Nome de exercício inválido."];
                else if (!Enum.IsDefined(suggestion.Group))
                    problems[$"newExercises[{i}].group"] = ["Grupo muscular inválido."];
            }

            if (problems.Count > 0)
                return TypedResults.ValidationProblem(problems);
            newExercises = PlanMapping.WriteNewExercises(suggestions);
        }

        plan.Document = JsonDocument.Parse(normalized.Value.GetRawText());
        db.Entry(plan).Property(p => p.Document).IsModified = true;
        plan.NewExercises = newExercises;
        db.Entry(plan).Property(p => p.NewExercises).IsModified = true;
        // The user has now filled in what the failed extraction left empty.
        plan.ExtractionError = null;
        await SyncWrites.StampAsync(db, plan, userId, clock, ct);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return TypedResults.Ok(PlanMapping.ToResponse(plan, null));
    }

    private static async Task<Results<Ok<PlanVersionResponse>, NotFound, ValidationProblem, ProblemHttpResult>> ActivateAsync(
        Guid id,
        ActivatePlanRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        if (request?.CycleStart is { } cycleStart && !PlanActivation.IsValidCycleStart(cycleStart, clock.GetUtcNow()))
            return Invalid("cycleStart", "Data de início do ciclo inválida.");

        var result = await PlanActivation.ActivateAsync(db, clock, principal.GetUserId(), id, request?.CycleStart, ct);
        return result.Outcome switch
        {
            ActivationOutcome.Activated or ActivationOutcome.AlreadyActive => TypedResults.Ok(PlanMapping.ToResponse(result.Plan!, null)),
            ActivationOutcome.NotFound => TypedResults.NotFound(),
            ActivationOutcome.NotADraft => Problem(StatusCodes.Status409Conflict, "Conflito", "Esta versão já foi arquivada."),
            _ => TypedResults.ValidationProblem(result.Errors.ToDictionary(e => e.Key, e => e.Value)),
        };
    }

    /// <summary>The document read through <see cref="PlanDocuments.TryRead{T}"/> and written back in its canonical form.</summary>
    private static JsonElement? Normalize(PlanKind kind, JsonElement document, out Dictionary<string, string[]> errors)
    {
        errors = [];
        IReadOnlyList<string> paths;
        if (kind == PlanKind.Protocol)
        {
            if (PlanDocuments.TryRead<ProtocolDocument>(document, out var protocol, out paths))
                return PlanDocuments.Serialize(protocol!);
        }
        else if (PlanDocuments.TryRead<WorkoutDocument>(document, out var workout, out paths))
        {
            return PlanDocuments.Serialize(workout!);
        }

        errors = paths.Distinct(StringComparer.Ordinal).ToDictionary(p => p, _ => new[] { "Valor inválido." }, StringComparer.Ordinal);
        return null;
    }

    private static JsonElement EmptyDocument(PlanKind kind) =>
        kind == PlanKind.Protocol ? PlanDocuments.Serialize(new ProtocolDocument()) : PlanDocuments.Serialize(new WorkoutDocument());

    private static ValidationProblem Invalid(string field, string message) =>
        TypedResults.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });

    private static ProblemHttpResult Problem(int status, string title, string? detail = null) =>
        TypedResults.Problem(title: title, detail: detail, statusCode: status);
}
