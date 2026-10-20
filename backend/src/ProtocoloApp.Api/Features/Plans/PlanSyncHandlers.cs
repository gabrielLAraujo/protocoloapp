using System.Text.Json;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>
/// An entity that only the server writes: clients get it by pull and every push of it is rejected with
/// <see cref="SyncErrors.ReadOnly"/> (nothing is stored).
/// </summary>
public abstract class ReadOnlySyncHandler<TEntity, TPayload>(AppDbContext db) : ISyncHandler
    where TEntity : class, ISyncEntity
    where TPayload : class
{
    public abstract string Entity { get; }

    protected abstract TPayload CreatePayload(TEntity entity);

    public Task<SyncChangeResult> ApplyAsync(SyncChange change, Guid userId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(change);

        return Task.FromResult(SyncChangeResult.Rejected(change.Id, SyncErrors.ReadOnly));
    }

    public IQueryable<ISyncEntity> Query(Guid userId) => db.Set<TEntity>().Where(e => e.UserId == userId);

    public JsonElement ToPayload(ISyncEntity entity) => SyncPayload.Write(CreatePayload((TEntity)entity));
}

/// <summary>
/// The <c>plan_version</c> pull payload: <c>{kind, status, document, activated_at, low_confidence}</c>. The raw extraction and
/// the extraction error never reach the client. <c>document</c> keeps its own camelCase keys.
/// </summary>
public sealed record PlanVersionPayload
{
    public string Kind { get; init; } = "";

    public string Status { get; init; } = "";

    public JsonElement Document { get; init; }

    public DateTimeOffset? ActivatedAt { get; init; }

    public IReadOnlyList<string> LowConfidence { get; init; } = [];
}

/// <summary>Syncs <see cref="PlanVersion"/> as <c>plan_version</c>, pull only.</summary>
public sealed class PlanVersionSyncHandler(AppDbContext db) : ReadOnlySyncHandler<PlanVersion, PlanVersionPayload>(db)
{
    public const string EntityName = "plan_version";

    public override string Entity => EntityName;

    protected override PlanVersionPayload CreatePayload(PlanVersion entity)
    {
        ArgumentNullException.ThrowIfNull(entity);

        return new PlanVersionPayload
        {
            Kind = EnumText.ToText(entity.Kind),
            Status = EnumText.ToText(entity.Status),
            Document = entity.Document.RootElement.Clone(),
            ActivatedAt = entity.ActivatedAt,
            LowConfidence = entity.LowConfidence,
        };
    }
}

/// <summary>The <c>exercise</c> pull payload: <c>{name, normalized_name, primary_muscle_group, aliases, catalog_id}</c>.</summary>
public sealed record ExercisePayload
{
    public string Name { get; init; } = "";

    public string NormalizedName { get; init; } = "";

    public string PrimaryMuscleGroup { get; init; } = "";

    public IReadOnlyList<string> Aliases { get; init; } = [];

    public string? CatalogId { get; init; }
}

/// <summary>Syncs <see cref="Exercise"/> as <c>exercise</c>, pull only.</summary>
public sealed class ExerciseSyncHandler(AppDbContext db) : ReadOnlySyncHandler<Exercise, ExercisePayload>(db)
{
    public const string EntityName = "exercise";

    public override string Entity => EntityName;

    protected override ExercisePayload CreatePayload(Exercise entity)
    {
        ArgumentNullException.ThrowIfNull(entity);

        return new ExercisePayload
        {
            Name = entity.Name,
            NormalizedName = entity.NormalizedName,
            PrimaryMuscleGroup = EnumText.ToText(entity.PrimaryMuscleGroup),
            Aliases = entity.Aliases,
            CatalogId = entity.CatalogId,
        };
    }
}
