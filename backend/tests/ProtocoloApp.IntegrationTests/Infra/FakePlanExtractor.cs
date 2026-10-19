using System.Text.Json;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.IntegrationTests.Plans;

namespace ProtocoloApp.IntegrationTests.Infra;

/// <summary>An <see cref="IPlanExtractor"/> whose answer a test sets. It records what it was called with.</summary>
public sealed class FakePlanExtractor : IPlanExtractor
{
    public delegate Task<PlanExtractionResult> ExtractHandler(PlanKind kind, byte[] pdf, IReadOnlyList<ExerciseHint> known, CancellationToken ct);

    public ExtractHandler Handler { get; set; } = Default;

    public int Calls { get; private set; }

    public byte[]? LastPdf { get; private set; }

    public IReadOnlyList<ExerciseHint> LastKnown { get; private set; } = [];

    /// <summary>Back to the default answer and a clean record; call at the start of a test.</summary>
    public void Reset()
    {
        Handler = Default;
        Calls = 0;
        LastPdf = null;
        LastKnown = [];
    }

    public async Task<PlanExtractionResult> ExtractAsync(PlanKind kind, Stream pdf, IReadOnlyList<ExerciseHint> knownExercises, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        await pdf.CopyToAsync(buffer, ct);
        Calls++;
        LastPdf = buffer.ToArray();
        LastKnown = knownExercises;
        return await Handler(kind, LastPdf, knownExercises, ct);
    }

    public static PlanExtractionResult Success(string documentJson, IReadOnlyList<NewExerciseSuggestion>? newExercises = null, IReadOnlyList<string>? lowConfidence = null) =>
        new(JsonDocument.Parse(documentJson), JsonDocument.Parse("""{"raw":true}"""), lowConfidence ?? [], newExercises ?? [], null);

    private static Task<PlanExtractionResult> Default(PlanKind kind, byte[] pdf, IReadOnlyList<ExerciseHint> known, CancellationToken ct) =>
        Task.FromResult(Success(kind == PlanKind.Workout ? PlanSamples.Workout : PlanSamples.Protocol));
}
