using System.Text.Json;
using Microsoft.Extensions.Options;

namespace ProtocoloApp.Api.Features.Plans.Extraction;

public interface IPlanExtractor
{
    Task<PlanExtractionResult> ExtractAsync(PlanKind kind, Stream pdf, IReadOnlyList<ExerciseHint> knownExercises, CancellationToken ct);
}

/// <summary>
/// Extracts a protocol or workout document from a PDF with one forced tool call. An invalid reply or a timeout is retried once;
/// the content of the PDF and of the reply is never logged.
/// </summary>
public sealed class PlanExtractor(AnthropicClient client, IOptions<AnthropicOptions> options, TimeProvider clock, ILogger<PlanExtractor> logger) : IPlanExtractor
{
    private const int Attempts = 2;

    /// <summary>The API caps a request at 32 MB and base64 adds a third: 20 MiB of PDF fits.</summary>
    public const int MaxPdfBytes = 20 * 1024 * 1024;

    // Brazil has no daylight saving time: a fixed UTC-3 gives the user's calendar date without needing tzdata.
    private static readonly TimeSpan BrazilOffset = TimeSpan.FromHours(-3);

    public async Task<PlanExtractionResult> ExtractAsync(PlanKind kind, Stream pdf, IReadOnlyList<ExerciseHint> knownExercises, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(pdf);
        ArgumentNullException.ThrowIfNull(knownExercises);

        if (!options.Value.IsConfigured)
            return PlanExtractionResult.Failure(PlanExtractionResult.Unavailable);

        // Bounded copy: stops buffering one byte past the cap instead of reading an oversized stream to the end.
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while (buffer.Length <= MaxPdfBytes
            && (read = await pdf.ReadAsync(chunk.AsMemory(0, (int)Math.Min(chunk.Length, MaxPdfBytes + 1 - buffer.Length)), ct)) > 0)
        {
            buffer.Write(chunk, 0, read);
        }

        if (buffer.Length > MaxPdfBytes)
            return PlanExtractionResult.Failure(PlanExtractionResult.TooLarge);
        var pdfBase64 = Convert.ToBase64String(buffer.GetBuffer(), 0, (int)buffer.Length);

        var today = DateOnly.FromDateTime(clock.GetUtcNow().ToOffset(BrazilOffset).DateTime);
        var prompt = ExtractionPrompts.Build(kind, today, knownExercises);
        var schema = ExtractionSchemas.For(kind);

        var error = PlanExtractionResult.InvalidExtraction;
        for (var attempt = 1; attempt <= Attempts; attempt++)
        {
            var call = await client.CallToolAsync(ExtractionSchemas.ToolName(kind), schema, prompt, pdfBase64, ct);
            if (call.Status == AnthropicCallStatus.Unavailable)
            {
                logger.LogWarning("Plan extraction ({Kind}) attempt {Attempt}: provider unavailable (status {Status}, error type {ErrorType}).", kind, attempt, call.StatusCode, call.ErrorType);
                // The provider refused this very request (a PDF it cannot read...): the service is fine, the file is the problem.
                if (call.StatusCode == 400 && call.ErrorType == "invalid_request_error")
                    return PlanExtractionResult.Failure(PlanExtractionResult.InvalidExtraction);

                error = PlanExtractionResult.Unavailable;
                // Overloaded or rate limited: worth one more try after a short wait. Anything else (401/403/404/413, 5xx, network) is final.
                if (call.StatusCode is 429 or 503 or 529 && attempt < Attempts)
                {
                    await Task.Delay(options.Value.RetryDelay, ct);
                    continue;
                }

                return PlanExtractionResult.Failure(error);
            }

            if (call.Status == AnthropicCallStatus.Timeout)
            {
                logger.LogWarning("Plan extraction ({Kind}) attempt {Attempt}: timeout.", kind, attempt);
                error = PlanExtractionResult.Timeout;
                continue;
            }

            if (call.StopReason == "max_tokens")
            {
                call.ToolInput?.Dispose();
                return PlanExtractionResult.Failure(PlanExtractionResult.TooLong);
            }

            if (call.StopReason == "refusal")
            {
                call.ToolInput?.Dispose();
                return PlanExtractionResult.Failure(PlanExtractionResult.InvalidExtraction);
            }

            using (call.ToolInput)
            {
                var result = call.ToolInput is null ? null : Interpret(kind, call.ToolInput.RootElement, knownExercises);
                if (result is not null)
                    return result;
            }

            logger.LogWarning("Plan extraction ({Kind}) attempt {Attempt}: invalid reply.", kind, attempt);
            error = PlanExtractionResult.InvalidExtraction;
        }

        return PlanExtractionResult.Failure(error);
    }

    /// <summary>Null when the tool input is not a valid document.</summary>
    private static PlanExtractionResult? Interpret(PlanKind kind, JsonElement input, IReadOnlyList<ExerciseHint> known)
    {
        if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty("document", out var documentElement))
            return null;

        var lowConfidence = new List<string>();
        if (input.TryGetProperty("lowConfidence", out var low) && low.ValueKind == JsonValueKind.Array)
        {
            lowConfidence.AddRange(low.EnumerateArray()
                .Where(e => e.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(e.GetString()))
                .Select(e => e.GetString()!));
        }

        JsonElement normalized;
        var newExercises = new List<NewExerciseSuggestion>();
        if (kind == PlanKind.Protocol)
        {
            if (!PlanDocuments.TryRead<ProtocolDocument>(documentElement, out var protocol, out _)
                || !new ProtocolDocumentValidator().Validate(protocol!).IsValid)
            {
                return null;
            }

            normalized = PlanDocuments.Serialize(protocol!);
        }
        else
        {
            if (!PlanDocuments.TryRead<WorkoutDocument>(documentElement, out var workout, out _))
                return null;

            workout = LinkExercises(workout!, known, lowConfidence);
            if (!new WorkoutDocumentValidator().Validate(workout).IsValid)
                return null;

            normalized = PlanDocuments.Serialize(workout);
            newExercises.AddRange(ReadNewExercises(input, known));
        }

        return new PlanExtractionResult(
            JsonDocument.Parse(normalized.GetRawText()),
            JsonDocument.Parse(input.GetRawText()),
            lowConfidence.Select(StripPrefix).Distinct(StringComparer.Ordinal).Where(path => Resolves(normalized, path)).ToList(),
            newExercises,
            null);
    }

    private static string StripPrefix(string path)
    {
        path = path.Trim();
        foreach (var prefix in new[] { "$.", "document." })
        {
            if (path.StartsWith(prefix, StringComparison.Ordinal))
                return path[prefix.Length..];
        }

        return path;
    }

    /// <summary>Whether a path such as <c>days[0].exercises[1].sets</c> exists in the document (a property with a null value exists).</summary>
    internal static bool Resolves(JsonElement root, string path)
    {
        var node = root;
        foreach (var segment in path.Split('.'))
        {
            var bracket = segment.IndexOf('[', StringComparison.Ordinal);
            var name = bracket < 0 ? segment : segment[..bracket];
            if (name.Length > 0 && (node.ValueKind != JsonValueKind.Object || !node.TryGetProperty(name, out node)))
                return false;

            var rest = bracket < 0 ? "" : segment[bracket..];
            while (rest.Length > 0)
            {
                var close = rest.IndexOf(']', StringComparison.Ordinal);
                if (rest[0] != '[' || close < 2 || !int.TryParse(rest[1..close], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var index)
                    || node.ValueKind != JsonValueKind.Array || index >= node.GetArrayLength())
                {
                    return false;
                }

                node = node[index];
                rest = rest[(close + 1)..];
            }
        }

        return path.Length > 0;
    }

    /// <summary>
    /// Keeps only exercise ids the user's catalog has (a made-up id becomes null and low confidence) and fills the id of
    /// an exercise whose normalized name matches a known one.
    /// </summary>
    private static WorkoutDocument LinkExercises(WorkoutDocument workout, IReadOnlyList<ExerciseHint> known, List<string> lowConfidence)
    {
        var byId = known.Select(k => k.Id).ToHashSet();
        var byName = new Dictionary<string, Guid>(StringComparer.Ordinal);
        foreach (var hint in known)
            byName.TryAdd(ExerciseNames.Normalize(hint.Name), hint.Id);

        var days = (workout.Days ?? []).Select((day, i) => day is null ? day! : day with
        {
            Exercises = (day.Exercises ?? []).Select((exercise, j) =>
            {
                if (exercise is null)
                    return exercise!; // kept as is: the validator reports the null element

                var id = exercise.ExerciseId;
                if (id is { } given && !byId.Contains(given))
                {
                    id = null;
                    lowConfidence.Add($"days[{i}].exercises[{j}].exerciseId");
                }

                if (id is null && !string.IsNullOrWhiteSpace(exercise.Name) && byName.TryGetValue(ExerciseNames.Normalize(exercise.Name), out var match))
                    id = match;

                return exercise with { ExerciseId = id };
            }).ToList(),
        }).ToList();

        return workout with { Days = days };
    }

    private static IEnumerable<NewExerciseSuggestion> ReadNewExercises(JsonElement input, IReadOnlyList<ExerciseHint> known)
    {
        if (!input.TryGetProperty("newExercises", out var list) || list.ValueKind != JsonValueKind.Array)
            yield break;

        var skip = known.Select(k => ExerciseNames.Normalize(k.Name)).ToHashSet(StringComparer.Ordinal);
        foreach (var element in list.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object
                || !element.TryGetProperty("name", out var nameElement) || nameElement.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            var name = nameElement.GetString()!.Trim();
            var normalized = ExerciseNames.Normalize(name);
            if (!ExerciseNames.IsUsable(normalized) || !skip.Add(normalized))
                continue;

            var group = MuscleGroup.Other;
            if (element.TryGetProperty("group", out var groupElement) && groupElement.ValueKind == JsonValueKind.String)
            {
                try
                {
                    group = EnumText.Parse<MuscleGroup>(groupElement.GetString()!);
                }
                catch (FormatException)
                {
                }
            }

            yield return new NewExerciseSuggestion(name, group);
        }
    }
}
