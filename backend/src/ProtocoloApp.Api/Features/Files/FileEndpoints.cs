using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.Api.Shared.Storage;

namespace ProtocoloApp.Api.Features.Files;

/// <summary>
/// Files in object storage through presigned URLs: <c>upload-url</c> registers a pending file and signs the PUT,
/// <c>confirm</c> checks the stored object, <c>download-url</c> signs the GET. A file of another user is a 404.
/// </summary>
public static class FileEndpoints
{
    public static void MapFiles(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        var group = api.MapGroup("/files").WithTags("Files");
        group.MapPost("/upload-url", UploadUrlAsync);
        group.MapPost("/{id:guid}/confirm", ConfirmAsync);
        group.MapGet("/{id:guid}/download-url", DownloadUrlAsync);
    }

    private static async Task<Results<Ok<UploadUrlResponse>, ValidationProblem>> UploadUrlAsync(
        UploadUrlRequest? request,
        ClaimsPrincipal principal,
        AppDbContext db,
        IFileStorage storage,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(storage);
        ArgumentNullException.ThrowIfNull(clock);

        if (request is null)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["body"] = ["Corpo da requisição inválido."] });

        var errors = new Dictionary<string, string[]>();
        if (!Enum.IsDefined(request.Kind))
            errors["kind"] = ["Tipo de arquivo inválido."];
        else if (!FileRules.IsAllowed(request.Kind, request.ContentType))
            errors["contentType"] = ["Tipo de conteúdo não permitido para este arquivo."];
        if (request.SizeBytes is < 1 or > FileRules.MaxSizeBytes)
            errors["sizeBytes"] = ["O arquivo deve ter entre 1 byte e 25 MB."];
        if (errors.Count > 0)
            return TypedResults.ValidationProblem(errors);

        var userId = principal.GetUserId();
        var now = clock.GetUtcNow();
        var id = Guid.NewGuid();
        var contentType = request.ContentType.ToLowerInvariant();
        var key = FileRules.StorageKey(userId, request.Kind, id);

        // Signed first: if signing fails there is no pending row left behind.
        var url = storage.GetUploadUrl(key, contentType, request.SizeBytes, FileRules.UploadUrlTtl);
        db.Files.Add(new FileRecord
        {
            Id = id,
            UserId = userId,
            StorageKey = key,
            ContentType = contentType,
            SizeBytes = request.SizeBytes,
            Kind = request.Kind,
            Status = FileStatus.Pending,
            CreatedAt = now,
        });
        await db.SaveChangesAsync(ct);

        return TypedResults.Ok(new UploadUrlResponse(id, url, now + FileRules.UploadUrlTtl));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> ConfirmAsync(
        Guid id,
        ClaimsPrincipal principal,
        AppDbContext db,
        IFileStorage storage,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(storage);

        var userId = principal.GetUserId();
        var file = await db.Files.SingleOrDefaultAsync(f => f.Id == id && f.UserId == userId, ct);
        if (file is null)
            return TypedResults.NotFound();

        if (file.Status == FileStatus.Confirmed)
            return TypedResults.NoContent();

        var stored = await storage.HeadAsync(file.StorageKey, ct);
        if (stored is null)
            return Conflict("O arquivo ainda não foi enviado.");
        if (stored.SizeBytes != file.SizeBytes)
            return Conflict("O tamanho do arquivo enviado não confere com o informado.");

        file.Status = FileStatus.Confirmed;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<DownloadUrlResponse>, NotFound, ProblemHttpResult>> DownloadUrlAsync(
        Guid id,
        ClaimsPrincipal principal,
        AppDbContext db,
        IFileStorage storage,
        TimeProvider clock,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(principal);
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(storage);
        ArgumentNullException.ThrowIfNull(clock);

        var userId = principal.GetUserId();
        var file = await db.Files.AsNoTracking().SingleOrDefaultAsync(f => f.Id == id && f.UserId == userId, ct);
        if (file is null)
            return TypedResults.NotFound();
        if (file.Status != FileStatus.Confirmed)
            return Conflict("O envio do arquivo ainda não foi confirmado.");

        var url = storage.GetDownloadUrl(file.StorageKey, FileRules.DownloadUrlTtl);
        return TypedResults.Ok(new DownloadUrlResponse(url, clock.GetUtcNow() + FileRules.DownloadUrlTtl));
    }

    private static ProblemHttpResult Conflict(string detail) =>
        TypedResults.Problem(title: "Conflito", detail: detail, statusCode: StatusCodes.Status409Conflict);
}
