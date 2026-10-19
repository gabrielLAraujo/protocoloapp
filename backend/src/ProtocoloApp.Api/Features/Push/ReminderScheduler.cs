using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Today;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Push;

public sealed class RemindersOptions
{
    public const string Section = "Reminders";

    /// <summary>Off in tests, which call <see cref="ReminderScheduler.RunOnceAsync"/> themselves.</summary>
    public bool Enabled { get; set; } = true;
}

/// <summary>
/// Once a minute, sends the reminders that are due: for every user with a push subscription it builds the local day
/// (<see cref="DayPlanner"/>, same rules as the app), takes the targets with reminders on whose time is this minute (or up
/// to <see cref="LateTolerance"/> minutes ago) and that are not logged yet, and sends one push per slot.
/// </summary>
public sealed class ReminderScheduler(
    IServiceScopeFactory scopes,
    TimeProvider clock,
    IZoneProvider zones,
    IOptions<RemindersOptions> options,
    ILogger<ReminderScheduler> logger) : BackgroundService
{
    /// <summary>Minutes a tick may be late (restart, slow loop) and still send.</summary>
    public const int LateTolerance = 2;

    public static readonly TimeSpan Tick = TimeSpan.FromSeconds(60);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
            return;

        using var timer = new PeriodicTimer(Tick, clock);
        do
        {
            try
            {
                await RunOnceAsync(clock.GetUtcNow(), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                // Only the type: messages of database errors may carry values.
                logger.LogError("Reminder tick failed: {Error}.", ex.GetType().Name);
            }
        }
        while (await WaitAsync(timer, stoppingToken));
    }

    private static async Task<bool> WaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    /// <summary>
    /// One pass at <paramref name="now"/>; returns how many slot reminders were claimed and kept (reached a device or removed
    /// one). A slot whose push reached no device, removed none and failed transiently is released for the next tick.
    /// </summary>
    public async Task<int> RunOnceAsync(DateTimeOffset now, CancellationToken ct)
    {
        var zone = zones.Zone;
        var local = TimeZoneInfo.ConvertTime(now, zone);
        var date = DateOnly.FromDateTime(local.DateTime);
        var minuteOfDay = local.Hour * 60 + local.Minute;

        List<Guid> userIds;
        await using (var listScope = scopes.CreateAsyncScope())
        {
            userIds = await listScope.ServiceProvider.GetRequiredService<AppDbContext>()
                .PushSubscriptions.AsNoTracking().Select(s => s.UserId).Distinct().OrderBy(id => id).ToListAsync(ct);
        }

        var claimed = 0;
        foreach (var userId in userIds)
        {
            try
            {
                // A scope (and DbContext) per user: whatever goes wrong for one user leaves nothing behind for the next.
                await using var userScope = scopes.CreateAsyncScope();
                var db = userScope.ServiceProvider.GetRequiredService<AppDbContext>();
                var sender = userScope.ServiceProvider.GetRequiredService<IPushSender>();
                claimed += await RunForUserAsync(db, sender, userId, date, minuteOfDay, zone, now, logger, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // One user's problem must not stop the others. Only the type is logged.
                logger.LogError("Reminders for a user failed: {Error}.", ex.GetType().Name);
            }
        }

        return claimed;
    }

    private static async Task<int> RunForUserAsync(
        AppDbContext db, IPushSender sender, Guid userId, DateOnly date, int minuteOfDay, TimeZoneInfo zone, DateTimeOffset now, ILogger logger, CancellationToken ct)
    {
        var plan = await BuildDayAsync(db, userId, date, zone, ct);

        var logged = (await db.AdherenceLogs.AsNoTracking()
                .Where(a => a.UserId == userId && a.Date == date && a.DeletedAt == null)
                .Select(a => new { a.TargetType, a.TargetKey })
                .ToListAsync(ct))
            .Select(a => (a.TargetType, a.TargetKey))
            .ToHashSet();
        await AddCheckinPartsDoneAsync(db, userId, date, logged, ct);

        var due = plan.Targets
            .Where(t => t is { ReminderEnabled: true, SlotKey: not null, Time: not null })
            .Where(t => !logged.Contains((t.Type, t.Key)))
            .Where(t =>
            {
                var late = minuteOfDay - (t.Time!.Value.Hour * 60 + t.Time.Value.Minute);
                return late is >= 0 and <= LateTolerance;
            })
            .GroupBy(t => t.SlotKey!, StringComparer.Ordinal);

        var claimed = 0;
        foreach (var slot in due)
        {
            // Claim first: the unique (user, date, slot) row means "somebody already took this one".
            var claimId = Guid.NewGuid();
            var inserted = await db.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO reminder_sends (id, user_id, date, slot, sent_at) VALUES ({claimId}, {userId}, {date}, {slot.Key}, {now.ToUniversalTime()}) ON CONFLICT (user_id, date, slot) DO NOTHING",
                ct);
            if (inserted == 0)
                continue;

            // The meal's own label, even when the meal itself is logged and only its items are left.
            var mealLabel = plan.Targets.FirstOrDefault(t => t.SlotKey == slot.Key && t.Type == AdherenceTargetType.Meal)?.Label;
            var time = slot.First().Time!.Value;
            var result = await PushDispatcher.SendToUserAsync(db, sender, userId, ReminderCopy.For(slot.Key, time, mealLabel), logger, ct);
            if (result is { Sent: 0, Removed: 0, Transient: > 0 })
            {
                // No device got it, none was dropped and some failure was transient: release this claim (only ours, by id)
                // so the next tick retries. Permanent failures are not retried (they were counted once). The retry stops by
                // itself once the slot is more than LateTolerance minutes late.
                // A timeout counted as transient may hide a push that was in fact delivered, so a retry can show it twice;
                // the notification tag replaces the earlier one on the device, and that is accepted.
                await db.ReminderSends.Where(r => r.Id == claimId).ExecuteDeleteAsync(ct);
                logger.LogWarning("Reminder for a slot reached no device; released for a retry within the tolerance window.");
                continue;
            }

            claimed++;
        }

        return claimed;
    }

    /// <summary>
    /// A check-in target is done when it is logged, or when its part is already saved in the day's check-in (the app saves
    /// the part, its adherence log may not have reached the server yet). The legacy <c>checkin</c> log counts as the evening
    /// part; a full check-in row (saved before the split) counts as both parts.
    /// </summary>
    private static async Task AddCheckinPartsDoneAsync(
        AppDbContext db, Guid userId, DateOnly date, HashSet<(AdherenceTargetType, string)> logged, CancellationToken ct)
    {
        if (logged.Contains((AdherenceTargetType.Checkin, DayPlanner.LegacyCheckinKey)))
            logged.Add((AdherenceTargetType.Checkin, DayPlanner.CheckinEveningKey));

        var checkin = await db.DailyCheckins.AsNoTracking()
            .Where(c => c.UserId == userId && c.Date == date && c.DeletedAt == null)
            .Select(c => new
            {
                Morning = c.SleepQuality != null && c.EnergyWake != null && c.Bowel != null,
                Evening = c.EnergyDay != null && c.Anxiety != null && c.WaterL != null,
            })
            .FirstOrDefaultAsync(ct);
        if (checkin is null)
            return;
        if (checkin.Morning)
            logged.Add((AdherenceTargetType.Checkin, DayPlanner.CheckinMorningKey));
        if (checkin.Evening)
            logged.Add((AdherenceTargetType.Checkin, DayPlanner.CheckinEveningKey));
    }

    private static async Task<DayPlan> BuildDayAsync(AppDbContext db, Guid userId, DateOnly date, TimeZoneInfo zone, CancellationToken ct)
    {
        var versions = await db.PlanVersions.AsNoTracking()
            .Where(p => p.UserId == userId && p.DeletedAt == null && p.ActivatedAt != null)
            .Select(p => new { p.Kind, p.Status, p.ActivatedAt, p.Document })
            .ToListAsync(ct);

        ProtocolDocument? protocol = null;
        DateOnly? protocolActivatedOn = null;
        var active = versions.Where(v => v.Kind == PlanKind.Protocol && v.Status == PlanStatus.Active).OrderByDescending(v => v.ActivatedAt).FirstOrDefault();
        if (active is not null && PlanDocuments.TryRead<ProtocolDocument>(active.Document.RootElement, out var document, out _))
        {
            protocol = document;
            protocolActivatedOn = LocalDate(active.ActivatedAt!.Value, zone);
        }

        var workouts = new List<WorkoutPlanAt>();
        foreach (var v in versions.Where(v => v.Kind == PlanKind.Workout))
        {
            // Same as the client: an unreadable version is skipped, so the previous one keeps applying.
            if (!PlanDocuments.TryRead<WorkoutDocument>(v.Document.RootElement, out var workout, out _) || workout is null)
                continue;
            workouts.Add(new WorkoutPlanAt(v.ActivatedAt!.Value, LocalDate(v.ActivatedAt.Value, zone), workout.Rotation));
        }

        var overrides = (await db.RotationOverrides.AsNoTracking()
                .Where(o => o.UserId == userId && o.DeletedAt == null)
                .Select(o => new { o.Date, o.WorkoutDayKey })
                .ToListAsync(ct))
            .Select(o => new RotationOverrideRow(o.Date, o.WorkoutDayKey))
            .ToList();

        // None (no workout plan) uses the rest-day times, as DayPlanner does.
        var slots = (await db.ScheduleSlots.AsNoTracking()
                .Where(s => s.UserId == userId && s.DeletedAt == null)
                .Select(s => new { s.Slot, s.DayType, s.Time, s.ReminderEnabled })
                .ToListAsync(ct))
            .Select(s => new ScheduleSlotRow(s.Slot, s.DayType, s.Time, s.ReminderEnabled))
            .ToList();

        return DayPlanner.Build(date, protocol, workouts, overrides, slots, protocolActivatedOn);
    }

    private static DateOnly LocalDate(DateTimeOffset instant, TimeZoneInfo zone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);
}
