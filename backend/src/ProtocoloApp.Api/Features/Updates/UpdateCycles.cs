using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Updates;

/// <summary>
/// How the server creates and moves the update cycles: one per protocol version that is (or was) active with an update
/// date. Every write goes through <see cref="SyncWrites"/>, inside the caller's transaction when there is one.
/// </summary>
public static class UpdateCycles
{
    // Brazil has no daylight saving time: a fixed UTC-3 gives the local date (same as PlanActivation).
    private static readonly TimeSpan BrazilOffset = TimeSpan.FromHours(-3);

    /// <summary>
    /// The cycle of the user's active protocol: the existing one, or a new <c>collecting</c> cycle from the local date of the
    /// activation to the protocol's <c>updateDate</c>. Null when there is no active protocol, or when it has no update date
    /// and no cycle yet. Idempotent.
    /// </summary>
    public static async Task<UpdateCycle?> EnsureForActiveProtocolAsync(AppDbContext db, Guid userId, TimeProvider clock, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        await using var owned = db.Database.CurrentTransaction is null ? await SyncWrites.BeginAsync(db, userId, ct) : null;

        var protocol = await db.PlanVersions.SingleOrDefaultAsync(
            p => p.UserId == userId && p.Kind == PlanKind.Protocol && p.Status == PlanStatus.Active && p.DeletedAt == null,
            ct);
        if (protocol is null)
            return null;

        var cycle = await db.UpdateCycles.SingleOrDefaultAsync(c => c.UserId == userId && c.ProtocolVersionId == protocol.Id, ct);
        if (cycle is null)
        {
            if (UpdateDateOf(protocol) is not { } updateDate)
                return null;

            cycle = await AddAsync(db, protocol, updateDate, clock, ct);
            await db.SaveChangesAsync(ct);
        }

        if (owned is not null)
            await owned.CommitAsync(ct);
        return cycle;
    }

    /// <summary>
    /// The protocol's update date changed to <paramref name="updateDate"/>: its cycle (unless <c>sent</c>) gets the new
    /// <c>period_end</c> (null keeps it); an active protocol without a cycle gets one. Must run inside a
    /// <see cref="SyncWrites.BeginAsync"/> transaction. The cycle keeps its <c>ClientUpdatedAt</c>, so an answer edited on the
    /// device before this change still wins (only the server fields moved).
    /// </summary>
    public static async Task ApplyDatesAsync(AppDbContext db, PlanVersion protocol, DateOnly? updateDate, TimeProvider clock, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(protocol);
        ArgumentNullException.ThrowIfNull(clock);

        if (protocol.Kind != PlanKind.Protocol)
            return;

        var cycle = await db.UpdateCycles.SingleOrDefaultAsync(c => c.UserId == protocol.UserId && c.ProtocolVersionId == protocol.Id, ct);
        if (cycle is null)
        {
            if (updateDate is { } date && protocol.Status == PlanStatus.Active && protocol.DeletedAt is null)
            {
                await AddAsync(db, protocol, date, clock, ct);
                await db.SaveChangesAsync(ct);
            }

            return;
        }

        if (cycle.Status == UpdateCycleStatus.Sent || updateDate is not { } newEnd || cycle.PeriodEnd == newEnd)
            return;

        cycle.PeriodEnd = newEnd;
        var clientUpdatedAt = cycle.ClientUpdatedAt;
        await SyncWrites.StampAsync(db, cycle, cycle.UserId, clock, ct);
        cycle.ClientUpdatedAt = clientUpdatedAt;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>The answers of a cycle (<c>key -> text</c>).</summary>
    public static IReadOnlyDictionary<string, string?> ReadAnswers(UpdateCycle cycle)
    {
        ArgumentNullException.ThrowIfNull(cycle);
        return cycle.Answers.Deserialize<Dictionary<string, string?>>() ?? new Dictionary<string, string?>();
    }

    /// <summary>The photos of a cycle.</summary>
    public static IReadOnlyList<UpdateCyclePhotoDto> ReadPhotos(UpdateCycle cycle)
    {
        ArgumentNullException.ThrowIfNull(cycle);
        return cycle.Photos.Deserialize<List<UpdateCyclePhotoDto>>(SyncPayload.Options) ?? [];
    }

    internal static JsonDocument WriteAnswers(IReadOnlyDictionary<string, string?>? answers) =>
        JsonSerializer.SerializeToDocument(answers ?? new Dictionary<string, string?>());

    internal static JsonDocument WritePhotos(IEnumerable<UpdateCyclePhotoDto?>? photos) =>
        JsonSerializer.SerializeToDocument((photos ?? []).OfType<UpdateCyclePhotoDto>().ToList(), SyncPayload.Options);

    private static DateOnly? UpdateDateOf(PlanVersion protocol) =>
        PlanDocuments.TryRead<ProtocolDocument>(protocol.Document.RootElement, out var document, out _) ? document!.UpdateDate : null;

    private static async Task<UpdateCycle> AddAsync(AppDbContext db, PlanVersion protocol, DateOnly updateDate, TimeProvider clock, CancellationToken ct)
    {
        var activatedAt = protocol.ActivatedAt ?? clock.GetUtcNow();
        var cycle = new UpdateCycle
        {
            Id = Guid.NewGuid(),
            UserId = protocol.UserId,
            ProtocolVersionId = protocol.Id,
            PeriodStart = DateOnly.FromDateTime(activatedAt.ToOffset(BrazilOffset).DateTime),
            PeriodEnd = updateDate,
            Status = UpdateCycleStatus.Collecting,
        };
        await SyncWrites.StampAsync(db, cycle, protocol.UserId, clock, ct);
        db.UpdateCycles.Add(cycle);
        return cycle;
    }
}
