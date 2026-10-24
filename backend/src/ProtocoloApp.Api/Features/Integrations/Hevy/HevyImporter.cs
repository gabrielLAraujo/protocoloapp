using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;
using ProtocoloApp.Api.Features.Workouts;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>What happened to one Hevy workout or deletion event.</summary>
public enum ImportOutcome
{
    /// <summary>A new session was created.</summary>
    Imported,

    /// <summary>The session was replaced with Hevy's newer data (same id, new sets).</summary>
    Updated,

    /// <summary>Deleted in Hevy: the session and its sets were soft-deleted.</summary>
    Deleted,

    /// <summary>Same (or older) <c>updated_at</c> as the last import, or a deletion of something not imported: nothing to do.</summary>
    Unchanged,

    /// <summary>No workout plan active on the workout's local date: not imported.</summary>
    SkippedNoPlan,

    /// <summary>The workout's local date is before <see cref="ImportContext.SyncFrom"/>.</summary>
    SkippedBeforeSyncFrom,

    /// <summary>The session was deleted in the app (or the workout cannot be stored): Hevy's changes are ignored for good.</summary>
    Dismissed,
}

/// <summary>What one import run shares between workouts. <see cref="SkippedSets"/> accumulates the sets left out.</summary>
/// <param name="templateGroup">
/// The <c>primary_muscle_group</c> of a Hevy template (null when unknown), asked only for templates that would get a new
/// exercise, and always before the workout's write transaction (it may call Hevy).
/// </param>
public sealed class ImportContext(DateOnly syncFrom, TimeZoneInfo zone, TimeProvider clock, Func<string, Task<string?>> templateGroup)
{
    public DateOnly SyncFrom { get; } = syncFrom;

    public TimeZoneInfo Zone { get; } = zone ?? throw new ArgumentNullException(nameof(zone));

    public TimeProvider Clock { get; } = clock ?? throw new ArgumentNullException(nameof(clock));

    public Func<string, Task<string?>> TemplateGroup { get; } = templateGroup ?? throw new ArgumentNullException(nameof(templateGroup));

    public int SkippedSets { get; set; }

    private readonly Dictionary<ImportOutcome, int> _counts = [];

    /// <summary>Records one outcome for <see cref="ToResult"/>; returns it, so <c>ctx.Count(await ApplyUpdatedAsync(...))</c> reads well.</summary>
    public ImportOutcome Count(ImportOutcome outcome)
    {
        _counts[outcome] = _counts.GetValueOrDefault(outcome) + 1;
        return outcome;
    }

    /// <summary>
    /// The run's counts. <see cref="ImportOutcome.Dismissed"/> counts as unchanged; <see cref="ImportOutcome.SkippedBeforeSyncFrom"/>
    /// is not counted (the initial load reads past the start date on purpose).
    /// </summary>
    public HevySyncResult ToResult(int pendingExercises) => new(
        _counts.GetValueOrDefault(ImportOutcome.Imported),
        _counts.GetValueOrDefault(ImportOutcome.Updated),
        _counts.GetValueOrDefault(ImportOutcome.Deleted),
        _counts.GetValueOrDefault(ImportOutcome.Unchanged) + _counts.GetValueOrDefault(ImportOutcome.Dismissed),
        _counts.GetValueOrDefault(ImportOutcome.SkippedNoPlan),
        SkippedSets,
        pendingExercises);
}

/// <summary>
/// Writes Hevy workouts as finished <see cref="WorkoutSession"/>s (spec "Hevy", section 3), one
/// <see cref="SyncWrites.BeginAsync"/> transaction per workout, every row stamped so devices receive it by pull:
/// <list type="bullet">
/// <item>the session is found by <c>(user, hevy, external_id)</c>, deleted rows included: one deleted in the app is never
/// brought back (<see cref="ImportOutcome.Dismissed"/>); one removed because Hevy deleted it comes back if Hevy lists it again;</item>
/// <item>a newer <c>updated_at</c> keeps the session id and replaces every set (old ones soft-deleted);</item>
/// <item>the workout mark of the date (<c>adherence_log</c> <c>workout/workout</c>, the device's deterministic id) is set to
/// <c>done</c> when a live finished session of that date has a working set, and a <c>done</c> mark is cleared when none is left
/// (the device's <c>saveLoggedSession</c> rule);</item>
/// <item>template groups (Hevy calls) are fetched before the transaction, and the plan day is chosen before any exercise is
/// linked, so a skipped workout creates nothing.</item>
/// </list>
/// Nothing from the workout (titles, notes, loads) is logged.
/// </summary>
public static class HevyImporter
{
    public static async Task<ImportOutcome> ApplyUpdatedAsync(AppDbContext db, Guid userId, HevyWorkout w, ImportContext ctx, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(w);
        ArgumentNullException.ThrowIfNull(ctx);

        if (string.IsNullOrEmpty(w.Id) || w.Id.Length > WorkoutSession.MaxExternalIdLength)
            return ImportOutcome.Dismissed;

        var date = HevyDayResolver.LocalDate(w.StartTime, ctx.Zone);
        if (date < ctx.SyncFrom)
            return ImportOutcome.SkippedBeforeSyncFrom;

        var updatedAt = Microseconds(w.UpdatedAt);
        var exercises = w.Exercises.Where(IsLinkable).ToList();

        // Hevy is asked for the muscle groups of new templates here, before the write transaction: no HTTP call ever runs while
        // the user's sync lock is held. Nothing is fetched for a workout that will not be written.
        // (Read-only pre-checks; the transaction below checks again.)
        var existing = await FindAsync(db, userId, w.Id, tracked: false, ct);
        if (existing is { DeletedAt: not null, ExternalUpdatedAt: not null })
            return ImportOutcome.Dismissed;
        if (existing?.ExternalUpdatedAt is { } seen && seen >= updatedAt)
            return ImportOutcome.Unchanged;
        if (!(await LoadPlansAsync(db, userId, ctx.Zone, ct)).Any(p => p.ActivatedOn <= date))
            return ImportOutcome.SkippedNoPlan;
        var templateGroups = await TemplateGroupsAsync(db, userId, exercises, ctx, ct);

        return await InTransactionAsync(db, userId, async () =>
        {
            var session = await FindAsync(db, userId, w.Id, tracked: true, ct);
            if (session is { DeletedAt: not null, ExternalUpdatedAt: not null })
                return ImportOutcome.Dismissed;
            if (session?.ExternalUpdatedAt is { } stored && stored >= updatedAt)
                return ImportOutcome.Unchanged;

            var plans = await LoadPlansAsync(db, userId, ctx.Zone, ct);
            if (!plans.Any(p => p.ActivatedOn <= date))
                return ImportOutcome.SkippedNoPlan;

            var overrides = (await db.RotationOverrides.AsNoTracking()
                    .Where(o => o.UserId == userId && o.DeletedAt == null)
                    .Select(o => new { o.Date, o.WorkoutDayKey })
                    .ToListAsync(ct))
                .Select(o => new RotationOverrideRow(o.Date, o.WorkoutDayKey))
                .ToList();

            // The day is chosen before anything is linked: a workout that cannot be placed leaves no provisional exercise
            // nor pending link behind. A provisional exercise is brand new, so it is in no plan day: null is the same to the resolver.
            var known = new List<Guid?>();
            foreach (var exercise in exercises)
                known.Add(await HevyExerciseLinker.PeekAsync(db, userId, exercise, ct));
            if (HevyDayResolver.Resolve(date, w, known, plans, overrides) is not { } day)
                return ImportOutcome.SkippedNoPlan;

            ctx.SkippedSets += w.Exercises.Where(e => !IsLinkable(e)).Sum(e => e.Sets.Count);
            var mapped = new List<Guid>();
            foreach (var exercise in exercises)
                mapped.Add(await HevyExerciseLinker.ResolveAsync(db, userId, exercise, templateGroups, ctx.Clock, ct));

            var planDay = plans.Single(p => p.Version.Id == day.PlanVersionId).Doc.Days.First(d => d?.Key == day.DayKey);

            // A session removed because Hevy deleted or no longer listed it (ExternalUpdatedAt cleared) comes back when Hevy
            // lists the workout again; only a deletion made in the app is final.
            var isNew = session is null || session.DeletedAt is not null;
            var revived = session is { DeletedAt: not null };
            var previousDate = session?.Date;
            if (session is null)
            {
                session = new WorkoutSession { Id = Guid.NewGuid(), UserId = userId, Source = SessionSource.Hevy, ExternalId = w.Id };
                db.WorkoutSessions.Add(session);
            }

            session.DeletedAt = null;
            session.Date = date;
            session.PlanVersionId = day.PlanVersionId;
            session.WorkoutDayKey = day.DayKey;
            session.StartedAt = w.StartTime;
            session.EndedAt = w.EndTime is { } end && end >= w.StartTime ? end : w.StartTime;
            session.Note = Trimmed(w.Description, WorkoutSession.MaxNoteLength);
            session.ExternalTitle = Trimmed(w.Title, WorkoutSession.MaxExternalTitleLength);
            session.ExternalUpdatedAt = updatedAt;
            await SyncWrites.StampAsync(db, session, userId, ctx.Clock, ct);

            if (!isNew || revived)
                await DeleteSetsAsync(db, userId, session.Id, ctx.Clock, ct);

            var nextIndex = new Dictionary<Guid, int>();
            var order = 0;
            for (var i = 0; i < exercises.Count; i++)
            {
                var exerciseId = mapped[i];
                var plannedKey = (planDay.Exercises ?? []).FirstOrDefault(e => e?.ExerciseId == exerciseId)?.Key;
                var (sets, skipped) = HevySetMapper.Map(
                    exercises[i], session.Id, exerciseId, plannedKey, userId, w.StartTime.AddSeconds(order), nextIndex.GetValueOrDefault(exerciseId));
                ctx.SkippedSets += skipped;
                order += sets.Count;
                if (sets.Count > 0)
                    nextIndex[exerciseId] = sets.Max(s => s.SetIndex) + 1;
                foreach (var set in sets)
                {
                    await SyncWrites.StampAsync(db, set, userId, ctx.Clock, ct);
                    db.SetLogs.Add(set);
                }
            }

            await db.SaveChangesAsync(ct);
            await SyncWorkoutMarkAsync(db, userId, date, ctx.Clock, ct);
            if (previousDate is { } before && before != date)
                await SyncWorkoutMarkAsync(db, userId, before, ctx.Clock, ct);

            return isNew ? ImportOutcome.Imported : ImportOutcome.Updated;
        }, ct);
    }

    public static async Task<ImportOutcome> ApplyDeletedAsync(AppDbContext db, Guid userId, string externalId, ImportContext ctx, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(ctx);

        if (string.IsNullOrEmpty(externalId) || externalId.Length > WorkoutSession.MaxExternalIdLength)
            return ImportOutcome.Unchanged;

        return await InTransactionAsync(db, userId, async () =>
        {
            var session = await FindAsync(db, userId, externalId, tracked: true, ct);
            if (session is null || session.DeletedAt is not null)
                return ImportOutcome.Unchanged;

            session.DeletedAt = ctx.Clock.GetUtcNow();
            // Cleared so the removal is not taken for a deletion made in the app: if Hevy lists the workout again
            // (for instance after a reconciliation that should not have removed it), the import brings it back.
            session.ExternalUpdatedAt = null;
            await SyncWrites.StampAsync(db, session, userId, ctx.Clock, ct);
            await DeleteSetsAsync(db, userId, session.Id, ctx.Clock, ct);
            await db.SaveChangesAsync(ct);
            await SyncWorkoutMarkAsync(db, userId, session.Date, ctx.Clock, ct);
            return ImportOutcome.Deleted;
        }, ct);
    }

    /// <summary>Links waiting for the user's confirmation (<see cref="HevySyncResult.PendingExercises"/>).</summary>
    public static Task<int> PendingExercisesAsync(AppDbContext db, Guid userId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        return db.HevyExerciseLinks.CountAsync(l => l.UserId == userId && l.Status == HevyLinkStatus.Pending, ct);
    }

    /// <summary>An exercise that can be linked (a storable template id) and has at least one set to keep.</summary>
    private static bool IsLinkable(HevyExercise e) =>
        e.TemplateId.Length is > 0 and <= HevyExerciseLink.MaxTemplateIdLength && HevySetMapper.HasImportableSet(e);

    private static async Task<ImportOutcome> InTransactionAsync(AppDbContext db, Guid userId, Func<Task<ImportOutcome>> work, CancellationToken ct)
    {
        var owned = db.Database.CurrentTransaction is null ? await SyncWrites.BeginAsync(db, userId, ct) : null;
        try
        {
            var outcome = await work();
            await db.SaveChangesAsync(ct);
            if (owned is not null)
                await owned.CommitAsync(ct);
            return outcome;
        }
        catch
        {
            // Nothing half-applied may be saved later by the same context.
            db.ChangeTracker.Clear();
            throw;
        }
        finally
        {
            if (owned is not null)
                await owned.DisposeAsync();
        }
    }

    private static Task<WorkoutSession?> FindAsync(AppDbContext db, Guid userId, string externalId, bool tracked, CancellationToken ct) =>
        (tracked ? db.WorkoutSessions : db.WorkoutSessions.AsNoTracking())
            .SingleOrDefaultAsync(s => s.UserId == userId && s.Source == SessionSource.Hevy && s.ExternalId == externalId, ct);

    /// <summary>
    /// The muscle groups of the templates that would get a new provisional exercise (<see cref="HevyExerciseLinker.PeekAsync"/>),
    /// asked through <see cref="ImportContext.TemplateGroup"/> (which may call Hevy). Must run outside the write transaction.
    /// </summary>
    private static async Task<Dictionary<string, string?>> TemplateGroupsAsync(
        AppDbContext db, Guid userId, IReadOnlyList<HevyExercise> exercises, ImportContext ctx, CancellationToken ct)
    {
        var groups = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var exercise in exercises)
        {
            if (groups.ContainsKey(exercise.TemplateId) || await HevyExerciseLinker.PeekAsync(db, userId, exercise, ct) is not null)
                continue;
            groups[exercise.TemplateId] = await ctx.TemplateGroup(exercise.TemplateId);
        }

        return groups;
    }

    private static async Task<List<(PlanVersion Version, WorkoutDocument Doc, DateOnly ActivatedOn)>> LoadPlansAsync(
        AppDbContext db, Guid userId, TimeZoneInfo zone, CancellationToken ct)
    {
        var versions = await db.PlanVersions.AsNoTracking()
            .Where(p => p.UserId == userId && p.Kind == PlanKind.Workout && p.DeletedAt == null && p.ActivatedAt != null)
            .ToListAsync(ct);
        var plans = new List<(PlanVersion Version, WorkoutDocument Doc, DateOnly ActivatedOn)>();
        foreach (var version in versions)
        {
            // Same as the client: an unreadable version is skipped, so the previous one keeps applying.
            if (PlanDocuments.TryRead<WorkoutDocument>(version.Document.RootElement, out var document, out _) && document is not null)
                plans.Add((version, document, HevyDayResolver.LocalDate(version.ActivatedAt!.Value, zone)));
        }

        return plans;
    }

    private static async Task DeleteSetsAsync(AppDbContext db, Guid userId, Guid sessionId, TimeProvider clock, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var sets = await db.SetLogs.Where(s => s.UserId == userId && s.SessionId == sessionId && s.DeletedAt == null).ToListAsync(ct);
        foreach (var set in sets)
        {
            set.DeletedAt = now;
            await SyncWrites.StampAsync(db, set, userId, clock, ct);
        }
    }

    /// <summary>
    /// Keeps the date's workout mark in step with the sessions: <c>done</c> when a live finished session of the date has a
    /// set that is not a warm-up, otherwise a <c>done</c> mark is cleared (a <c>partial</c>/<c>missed</c> one is left alone).
    /// </summary>
    private static async Task SyncWorkoutMarkAsync(AppDbContext db, Guid userId, DateOnly date, TimeProvider clock, CancellationToken ct)
    {
        var worked = await db.WorkoutSessions.AnyAsync(
            s => s.UserId == userId && s.Date == date && s.DeletedAt == null && s.EndedAt != null
                && db.SetLogs.Any(l => l.SessionId == s.Id && l.DeletedAt == null && l.Kind != SetKind.Warmup),
            ct);
        var live = await db.AdherenceLogs.FirstOrDefaultAsync(
            a => a.UserId == userId && a.Date == date && a.TargetType == AdherenceTargetType.Workout
                && a.TargetKey == DayPlanner.WorkoutKey && a.DeletedAt == null,
            ct);

        if (worked)
        {
            if (live is { Status: AdherenceStatus.Done })
                return;

            var id = AdherenceIds.For(userId, date, EnumText.ToText(AdherenceTargetType.Workout), DayPlanner.WorkoutKey);
            var mark = live ?? await db.AdherenceLogs.SingleOrDefaultAsync(a => a.Id == id && a.UserId == userId, ct);
            if (mark is null)
            {
                mark = new AdherenceLog
                {
                    Id = id,
                    UserId = userId,
                    Date = date,
                    TargetType = AdherenceTargetType.Workout,
                    TargetKey = DayPlanner.WorkoutKey,
                };
                db.AdherenceLogs.Add(mark);
            }

            mark.Date = date;
            mark.TargetType = AdherenceTargetType.Workout;
            mark.TargetKey = DayPlanner.WorkoutKey;
            mark.Status = AdherenceStatus.Done;
            mark.Reason = null;
            mark.DeletedAt = null;
            await SyncWrites.StampAsync(db, mark, userId, clock, ct);
        }
        else if (live is { Status: AdherenceStatus.Done })
        {
            live.DeletedAt = clock.GetUtcNow();
            await SyncWrites.StampAsync(db, live, userId, clock, ct);
        }
        else
        {
            return;
        }

        await db.SaveChangesAsync(ct);
    }

    private static string? Trimmed(string? text, int max)
    {
        var value = text?.Trim();
        if (string.IsNullOrEmpty(value))
            return null;
        return value.Length > max ? value[..max] : value;
    }

    /// <summary>The database keeps microseconds: comparing the stored <c>updated_at</c> needs the same precision.</summary>
    private static DateTimeOffset Microseconds(DateTimeOffset value) => new(value.UtcTicks / 10 * 10, TimeSpan.Zero);
}
