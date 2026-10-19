using System.Text.Json;
using FluentValidation.Results;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

public enum ActivationOutcome
{
    Activated,
    AlreadyActive,
    NotFound,
    NotADraft,
    Invalid,
}

public sealed record ActivationResult(ActivationOutcome Outcome, PlanVersion? Plan, IReadOnlyDictionary<string, string[]> Errors)
{
    public static ActivationResult Of(ActivationOutcome outcome, PlanVersion? plan = null) => new(outcome, plan, new Dictionary<string, string[]>());
}

/// <summary>
/// Turns a draft into the active version of its kind: validates the document, creates the new exercises (matching existing
/// ones by normalized name), archives the previous active version and stamps every changed row, all in one transaction.
/// </summary>
public static class PlanActivation
{
    // Brazil has no daylight saving time: a fixed UTC-3 is the user's local midnight without needing tzdata.
    private static readonly TimeSpan BrazilOffset = TimeSpan.FromHours(-3);

    /// <summary>Local midnight (America/Sao_Paulo) of <paramref name="cycleStart"/> in UTC, or <paramref name="now"/>.</summary>
    public static DateTimeOffset ActivationInstant(DateOnly? cycleStart, DateTimeOffset now) =>
        cycleStart is { } date
            ? new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue), BrazilOffset).ToUniversalTime()
            : now;

    public static readonly DateOnly MinCycleStart = new(2000, 1, 1);

    /// <summary>2000-01-01 up to one year after today (UTC date).</summary>
    public static bool IsValidCycleStart(DateOnly cycleStart, DateTimeOffset now) =>
        cycleStart >= MinCycleStart && cycleStart <= DateOnly.FromDateTime(now.UtcDateTime).AddYears(1);

    /// <summary>A date written in a plan document (update, billing): 2000-01-01 up to five years after today (UTC date).</summary>
    public static bool IsValidDocumentDate(DateOnly date, DateTimeOffset now) =>
        date >= MinCycleStart && date <= DateOnly.FromDateTime(now.UtcDateTime).AddYears(5);

    /// <summary>Structural validation of a document of the given kind; keys are JSON paths.</summary>
    public static Dictionary<string, string[]> Validate(PlanKind kind, JsonElement document)
    {
        if (kind == PlanKind.Protocol)
        {
            return PlanDocuments.TryRead<ProtocolDocument>(document, out var protocol, out var readErrors)
                ? Group(new ProtocolDocumentValidator().Validate(protocol!).Errors)
                : Unreadable(readErrors);
        }

        return PlanDocuments.TryRead<WorkoutDocument>(document, out var workout, out var errors)
            ? Group(new WorkoutDocumentValidator().Validate(workout!).Errors)
            : Unreadable(errors);
    }

    public static async Task<ActivationResult> ActivateAsync(
        AppDbContext db, TimeProvider clock, Guid userId, Guid planId, DateOnly? cycleStart, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        await using var transaction = await SyncWrites.BeginAsync(db, userId, ct);

        var plan = await db.PlanVersions.SingleOrDefaultAsync(p => p.Id == planId && p.UserId == userId && p.DeletedAt == null, ct);
        if (plan is null)
            return ActivationResult.Of(ActivationOutcome.NotFound);
        if (plan.Status == PlanStatus.Active)
            return ActivationResult.Of(ActivationOutcome.AlreadyActive, plan);
        if (plan.Status != PlanStatus.Draft)
            return ActivationResult.Of(ActivationOutcome.NotADraft, plan);

        var errors = Validate(plan.Kind, plan.Document.RootElement);
        if (errors.Count > 0)
            return new ActivationResult(ActivationOutcome.Invalid, plan, errors);

        var document = plan.Document.RootElement;
        if (plan.Kind == PlanKind.Workout)
        {
            // Validated above, so it reads.
            PlanDocuments.TryRead<WorkoutDocument>(document, out var workout, out _);
            var resolved = await LinkExercisesAsync(db, clock, userId, workout!, PlanMapping.ReadNewExercises(plan.NewExercises), ct);
            if (resolved.Errors.Count > 0)
                return new ActivationResult(ActivationOutcome.Invalid, plan, resolved.Errors);

            plan.Document = JsonDocument.Parse(PlanDocuments.Serialize(resolved.Document!).GetRawText());
            db.Entry(plan).Property(p => p.Document).IsModified = true;
            plan.NewExercises = null;
        }

        // The partial unique index (one active per user and kind) is not deferrable: archive first, then activate.
        var previous = await db.PlanVersions
            .Where(p => p.UserId == userId && p.Kind == plan.Kind && p.Status == PlanStatus.Active && p.DeletedAt == null && p.Id != plan.Id)
            .ToListAsync(ct);
        foreach (var old in previous)
        {
            old.Status = PlanStatus.Archived;
            await SyncWrites.StampAsync(db, old, userId, clock, ct);
        }

        await db.SaveChangesAsync(ct);

        plan.Status = PlanStatus.Active;
        plan.ActivatedAt = ActivationInstant(cycleStart, clock.GetUtcNow());
        await SyncWrites.StampAsync(db, plan, userId, clock, ct);
        await db.SaveChangesAsync(ct);

        await transaction.CommitAsync(ct);
        return ActivationResult.Of(ActivationOutcome.Activated, plan);
    }

    private sealed record Linked(WorkoutDocument? Document, IReadOnlyDictionary<string, string[]> Errors);

    /// <summary>
    /// Gives every exercise of the document an <c>exerciseId</c>: a given id must exist in the catalog; otherwise the name is
    /// matched by normalized name (or alias) and a new catalog exercise is created when nothing matches. Stamps what it
    /// adds or restores; saves nothing itself.
    /// </summary>
    private static async Task<Linked> LinkExercisesAsync(
        AppDbContext db, TimeProvider clock, Guid userId, WorkoutDocument workout, IReadOnlyList<NewExerciseSuggestion> suggestions, CancellationToken ct)
    {
        var catalog = await db.Exercises.Where(e => e.UserId == userId).ToListAsync(ct);
        var live = catalog.Where(e => e.DeletedAt is null).ToList();
        var liveIds = live.Select(e => e.Id).ToHashSet();
        var byName = catalog.ToDictionary(e => e.NormalizedName, StringComparer.Ordinal);
        var byAlias = new Dictionary<string, Exercise>(StringComparer.Ordinal);
        foreach (var exercise in live)
        {
            foreach (var alias in exercise.Aliases)
                byAlias.TryAdd(ExerciseNames.Normalize(alias), exercise);
        }

        var groups = new Dictionary<string, MuscleGroup>(StringComparer.Ordinal);
        foreach (var suggestion in suggestions)
            groups.TryAdd(ExerciseNames.Normalize(suggestion.Name), suggestion.Group);

        var errors = new Dictionary<string, string[]>();
        var days = new List<WorkoutDayDto>();
        for (var i = 0; i < workout.Days.Count; i++)
        {
            var exercises = new List<PlannedExerciseDto>();
            for (var j = 0; j < workout.Days[i].Exercises.Count; j++)
            {
                var planned = workout.Days[i].Exercises[j];
                var path = $"days[{i}].exercises[{j}]";
                if (planned.ExerciseId is { } given)
                {
                    if (!liveIds.Contains(given))
                        errors[$"{path}.exerciseId"] = ["Exercício não encontrado no catálogo."];
                    exercises.Add(planned);
                    continue;
                }

                var normalized = ExerciseNames.Normalize(planned.Name);
                if (!ExerciseNames.IsUsable(normalized))
                {
                    errors[$"{path}.name"] = ["Nome de exercício inválido."];
                    exercises.Add(planned);
                    continue;
                }

                if (!byName.TryGetValue(normalized, out var match) && !byAlias.TryGetValue(normalized, out match))
                {
                    var name = planned.Name.Trim();
                    match = new Exercise
                    {
                        Id = Guid.NewGuid(),
                        UserId = userId,
                        Name = name.Length > Exercise.MaxNameLength ? name[..Exercise.MaxNameLength] : name,
                        NormalizedName = normalized,
                        PrimaryMuscleGroup = groups.GetValueOrDefault(normalized, MuscleGroup.Other),
                    };
                    byName[normalized] = match;
                    await SyncWrites.StampAsync(db, match, userId, clock, ct);
                    db.Exercises.Add(match);
                }
                else if (match.DeletedAt is not null)
                {
                    // A removed exercise with the same name comes back (the name is unique per user, deleted or not).
                    match.DeletedAt = null;
                    await SyncWrites.StampAsync(db, match, userId, clock, ct);
                }

                exercises.Add(planned with { ExerciseId = match.Id });
            }

            days.Add(workout.Days[i] with { Exercises = exercises });
        }

        return errors.Count > 0 ? new Linked(null, errors) : new Linked(workout with { Days = days }, errors);
    }

    private static Dictionary<string, string[]> Group(IEnumerable<ValidationFailure> failures) => failures
        .GroupBy(f => f.PropertyName, StringComparer.Ordinal)
        .ToDictionary(g => g.Key, g => g.Select(f => f.ErrorMessage).Distinct(StringComparer.Ordinal).ToArray(), StringComparer.Ordinal);

    private static Dictionary<string, string[]> Unreadable(IReadOnlyList<string> paths) =>
        paths.Distinct(StringComparer.Ordinal).ToDictionary(path => path, _ => new[] { "Valor inválido." }, StringComparer.Ordinal);
}
