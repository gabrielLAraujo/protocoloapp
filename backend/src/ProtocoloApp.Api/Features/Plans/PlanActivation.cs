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
        var catalogLinks = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var suggestion in suggestions)
        {
            var key = ExerciseNames.Normalize(suggestion.Name);
            groups.TryAdd(key, suggestion.Group);
            if (suggestion.CatalogId is { } link)
                catalogLinks.TryAdd(key, link);
        }

        // The catalog is refreshed from outside: a link that disappeared since the draft was saved is simply dropped (only once
        // the catalog is synced; before that a well-formed link is kept, see CatalogLinks).
        var found = await CatalogLinks.KeptAsync(
            db,
            catalogLinks.Values.Concat(workout.Days.SelectMany(d => d.Exercises).Select(e => e.CatalogId)),
            ct);
        foreach (var key in catalogLinks.Where(kv => !found.Contains(kv.Value)).Select(kv => kv.Key).ToList())
            catalogLinks.Remove(key);

        // Exercises changed here but not created or restored (those are stamped where it happens): stamped once, at the end.
        var touched = new Dictionary<Guid, Exercise>();
        var stamped = new HashSet<Guid>();
        string? Link(string? id) => id is not null && found.Contains(id) ? id : null;

        var liveById = live.ToDictionary(e => e.Id);

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
                    else
                    {
                        var chosen = liveById[given];
                        // A pair the user picked by hand replaces the exercise's own; an automatic suggestion only fills a missing one.
                        var changed = planned.CatalogConfirmed == true
                            ? ReplaceCatalog(chosen, Link(planned.CatalogId))
                            : LinkCatalog(chosen, Link(planned.CatalogId));
                        // Only a pair the user picked in the review teaches an alias: an automatic match must not.
                        if (planned.AliasConfirmed == true)
                            changed |= LearnAlias(chosen, planned.Name, byName, byAlias);
                        if (changed)
                            touched[chosen.Id] = chosen;
                    }

                    exercises.Add(planned with { CatalogId = null, AliasConfirmed = null, CatalogConfirmed = null });
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
                        CatalogId = catalogLinks.GetValueOrDefault(normalized) ?? Link(planned.CatalogId),
                    };
                    byName[normalized] = match;
                    await SyncWrites.StampAsync(db, match, userId, clock, ct);
                    stamped.Add(match.Id);
                    db.Exercises.Add(match);
                }
                else if (match.DeletedAt is not null)
                {
                    // A removed exercise with the same name comes back (the name is unique per user, deleted or not).
                    match.DeletedAt = null;
                    LinkCatalog(match, catalogLinks.GetValueOrDefault(normalized) ?? Link(planned.CatalogId));
                    await SyncWrites.StampAsync(db, match, userId, clock, ct);
                    stamped.Add(match.Id);
                }
                else if (LinkCatalog(match, catalogLinks.GetValueOrDefault(normalized) ?? Link(planned.CatalogId)) && !stamped.Contains(match.Id))
                {
                    touched[match.Id] = match;
                }

                exercises.Add(planned with { ExerciseId = match.Id, CatalogId = null, AliasConfirmed = null, CatalogConfirmed = null });
            }

            days.Add(workout.Days[i] with { Exercises = exercises });
        }

        foreach (var exercise in touched.Values.Where(e => !stamped.Contains(e.Id)))
            await SyncWrites.StampAsync(db, exercise, userId, clock, ct);

        return errors.Count > 0 ? new Linked(null, errors) : new Linked(workout with { Days = days }, errors);
    }

    /// <summary>Most aliases an exercise keeps (same cap as the exercise endpoint).</summary>
    private const int MaxAliases = 20;

    /// <summary>Replaces the catalog link with the one the user confirmed in review; true when it changed.</summary>
    private static bool ReplaceCatalog(Exercise exercise, string? catalogId)
    {
        if (catalogId is null || exercise.CatalogId == catalogId)
            return false;
        exercise.CatalogId = catalogId;
        return true;
    }

    /// <summary>Sets the catalog link of an exercise that has none; true when it changed.</summary>
    private static bool LinkCatalog(Exercise exercise, string? catalogId)
    {
        if (catalogId is null || exercise.CatalogId is not null)
            return false;
        exercise.CatalogId = catalogId;
        return true;
    }

    /// <summary>
    /// The user picked an existing exercise for a plan name that differs from its name and aliases: the plan's name becomes an
    /// alias, so the next PDF links by itself. Idempotent; skipped when the name already belongs to another exercise or the
    /// exercise is at the alias cap. True when the aliases changed.
    /// </summary>
    private static bool LearnAlias(Exercise exercise, string plannedName, Dictionary<string, Exercise> byName, Dictionary<string, Exercise> byAlias)
    {
        var normalized = ExerciseNames.Normalize(plannedName);
        if (!ExerciseNames.IsUsable(normalized) || byName.ContainsKey(normalized) || byAlias.ContainsKey(normalized))
            return false;
        if (exercise.Aliases.Length >= MaxAliases)
            return false;

        var alias = plannedName.Trim();
        if (alias.Length > Exercise.MaxNameLength)
            alias = alias[..Exercise.MaxNameLength];
        exercise.Aliases = [.. exercise.Aliases, alias];
        byAlias[normalized] = exercise;
        return true;
    }

    private static Dictionary<string, string[]> Group(IEnumerable<ValidationFailure> failures) => failures
        .GroupBy(f => f.PropertyName, StringComparer.Ordinal)
        .ToDictionary(g => g.Key, g => g.Select(f => f.ErrorMessage).Distinct(StringComparer.Ordinal).ToArray(), StringComparer.Ordinal);

    private static Dictionary<string, string[]> Unreadable(IReadOnlyList<string> paths) =>
        paths.Distinct(StringComparer.Ordinal).ToDictionary(path => path, _ => new[] { "Valor inválido." }, StringComparer.Ordinal);
}
