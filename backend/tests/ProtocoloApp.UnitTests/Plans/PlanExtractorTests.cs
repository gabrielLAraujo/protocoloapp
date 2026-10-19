using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Plans.Extraction;

namespace ProtocoloApp.UnitTests.Plans;

public sealed class PlanExtractorTests
{
    private static readonly byte[] PdfBytes = Encoding.ASCII.GetBytes("%PDF-fixture");

    private sealed class FakeHandler(Func<int, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public List<string> Bodies { get; } = [];

        public List<HttpRequestMessage> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            Bodies.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
            return await respond(Bodies.Count, cancellationToken);
        }
    }

    private static string Fixture(string name) => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));

    private static Task<HttpResponseMessage> Json(string body, HttpStatusCode status = HttpStatusCode.OK) =>
        Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });

    private static PlanExtractor Create(FakeHandler handler, string? apiKey = "test-key", TimeSpan? timeout = null)
    {
        var options = Options.Create(new AnthropicOptions
        {
            ApiKey = apiKey,
            BaseUrl = "https://anthropic.test",
            Timeout = timeout ?? TimeSpan.FromSeconds(5),
        });
        var client = new AnthropicClient(new HttpClient(handler), options);
        return new PlanExtractor(client, options, new FixedClock(new DateTimeOffset(2026, 10, 18, 12, 0, 0, TimeSpan.Zero)), NullLogger<PlanExtractor>.Instance);
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static Task<PlanExtractionResult> Extract(PlanExtractor extractor, PlanKind kind, params ExerciseHint[] known) =>
        extractor.ExtractAsync(kind, new MemoryStream(PdfBytes), known, CancellationToken.None);

    [Fact]
    public async Task Valid_workout_reply_returns_document_low_confidence_and_new_exercises()
    {
        var known = new ExerciseHint(Guid.Parse("11111111-1111-1111-1111-111111111111"), "Supino inclinado halteres", MuscleGroup.Chest);
        var handler = new FakeHandler((_, _) => Json(Fixture("anthropic-workout-response.json")));

        var result = await Extract(Create(handler), PlanKind.Workout, known);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Error);
        Assert.Single(handler.Bodies);
        var workout = PlanDocuments.Deserialize<WorkoutDocument>(result.Document!.RootElement)!;
        Assert.Equal(new[] { "A", "B", "off" }, workout.Rotation!.Items);
        Assert.Equal(3, workout.Days[0].Exercises[0].Sets.Count);
        Assert.Equal("drop", workout.Days[0].Exercises[0].Sets[2].Technique);
        // Matched by normalized name even though the model left the id null.
        Assert.Equal(known.Id, workout.Days[0].Exercises[0].ExerciseId);
        // A made-up id is dropped and flagged.
        Assert.Null(workout.Days[1].Exercises[0].ExerciseId);
        Assert.Contains("days[1].exercises[0].exerciseId", result.LowConfidence);
        Assert.Contains("days[0].exercises[1].restSequence", result.LowConfidence);
        Assert.Equal(
            new[] { new NewExerciseSuggestion("Exercicio Ficticio Alfa", MuscleGroup.Chest), new NewExerciseSuggestion("Exercicio Ficticio Beta", MuscleGroup.Other) },
            result.NewExercises);
        Assert.NotNull(result.Raw);
    }

    [Fact]
    public async Task Valid_protocol_reply_returns_document_and_low_confidence()
    {
        var handler = new FakeHandler((_, _) => Json(Fixture("anthropic-protocol-response.json")));

        var result = await Extract(Create(handler), PlanKind.Protocol);

        Assert.True(result.IsSuccess);
        var protocol = PlanDocuments.Deserialize<ProtocolDocument>(result.Document!.RootElement)!;
        Assert.Equal(new DateOnly(2026, 12, 1), protocol.UpdateDate);
        Assert.Equal("2 capsulas (dose ficticia)", protocol.Items[0].DoseText);
        Assert.Equal(new[] { "updateDate", "items[1].schedule.anchor" }, result.LowConfidence);
        Assert.Empty(result.NewExercises);
        using var body = JsonDocument.Parse(handler.Bodies[0]);
        Assert.Equal("submit_protocol", body.RootElement.GetProperty("tool_choice").GetProperty("name").GetString());
    }

    [Fact]
    public async Task Invalid_first_reply_then_valid_succeeds_with_two_calls()
    {
        var handler = new FakeHandler((n, _) => Json(Fixture(n == 1 ? "anthropic-invalid-response.json" : "anthropic-workout-response.json")));

        var result = await Extract(Create(handler), PlanKind.Workout);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, handler.Bodies.Count);
    }

    [Fact]
    public async Task Two_invalid_replies_fail_with_invalid_extraction()
    {
        var handler = new FakeHandler((_, _) => Json(Fixture("anthropic-invalid-response.json")));

        var result = await Extract(Create(handler), PlanKind.Workout);

        Assert.False(result.IsSuccess);
        Assert.Equal("invalid_extraction", result.Error);
        Assert.Null(result.Document);
        Assert.Equal(2, handler.Bodies.Count);
    }

    [Fact]
    public async Task Reply_without_tool_use_counts_as_invalid()
    {
        var handler = new FakeHandler((_, _) => Json("""{ "content": [ { "type": "text", "text": "nao consegui" } ], "stop_reason": "end_turn" }"""));

        var result = await Extract(Create(handler), PlanKind.Workout);

        Assert.Equal("invalid_extraction", result.Error);
        Assert.Equal(2, handler.Bodies.Count);
    }

    [Fact]
    public async Task Timeout_is_retried_once_then_reported()
    {
        var handler = new FakeHandler(async (_, ct) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });

        var result = await Extract(Create(handler, timeout: TimeSpan.FromMilliseconds(50)), PlanKind.Workout);

        Assert.Equal("timeout", result.Error);
        Assert.Equal(2, handler.Bodies.Count);
    }

    [Fact]
    public async Task Timeout_then_valid_succeeds()
    {
        var handler = new FakeHandler(async (n, ct) =>
        {
            if (n == 1)
                await Task.Delay(Timeout.InfiniteTimeSpan, ct);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Fixture("anthropic-workout-response.json"), Encoding.UTF8, "application/json") };
        });

        var result = await Extract(Create(handler, timeout: TimeSpan.FromMilliseconds(50)), PlanKind.Workout);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, handler.Bodies.Count);
    }

    [Fact]
    public async Task Caller_cancellation_is_not_reported_as_timeout()
    {
        using var cts = new CancellationTokenSource();
        var handler = new FakeHandler(async (_, ct) =>
        {
            await cts.CancelAsync();
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Create(handler).ExtractAsync(PlanKind.Workout, new MemoryStream(PdfBytes), [], cts.Token));
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.Unauthorized)]
    public async Task Http_errors_are_unavailable_without_retry(HttpStatusCode status)
    {
        var handler = new FakeHandler((_, _) => Json("""{ "type": "error" }""", status));

        var result = await Extract(Create(handler), PlanKind.Workout);

        Assert.Equal("unavailable", result.Error);
        Assert.Single(handler.Bodies);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Missing_key_is_unavailable_without_http_call(string? key)
    {
        var handler = new FakeHandler((_, _) => Json(Fixture("anthropic-workout-response.json")));

        var result = await Extract(Create(handler, apiKey: key), PlanKind.Workout);

        Assert.Equal("unavailable", result.Error);
        Assert.Empty(handler.Bodies);
    }

    [Fact]
    public async Task Request_forces_the_tool_and_carries_headers_pdf_schema_and_prompt()
    {
        var known = new ExerciseHint(Guid.Parse("22222222-2222-2222-2222-222222222222"), "Leg 45", MuscleGroup.Quads);
        var handler = new FakeHandler((_, _) => Json(Fixture("anthropic-workout-response.json")));

        await Extract(Create(handler), PlanKind.Workout, known);

        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://anthropic.test/v1/messages", request.RequestUri!.ToString());
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("test-key", request.Headers.GetValues("x-api-key").Single());
        Assert.Equal("2023-06-01", request.Headers.GetValues("anthropic-version").Single());

        using var body = JsonDocument.Parse(handler.Bodies[0]);
        var root = body.RootElement;
        Assert.Equal("claude-sonnet-5-5", root.GetProperty("model").GetString());
        Assert.Equal(16000, root.GetProperty("max_tokens").GetInt32());
        Assert.Equal("tool", root.GetProperty("tool_choice").GetProperty("type").GetString());
        Assert.Equal("submit_workout", root.GetProperty("tool_choice").GetProperty("name").GetString());
        var tool = root.GetProperty("tools").EnumerateArray().Single();
        Assert.Equal("submit_workout", tool.GetProperty("name").GetString());
        Assert.Equal("object", tool.GetProperty("input_schema").GetProperty("type").GetString());

        var content = root.GetProperty("messages")[0].GetProperty("content");
        var document = content[0];
        Assert.Equal("document", document.GetProperty("type").GetString());
        Assert.Equal("application/pdf", document.GetProperty("source").GetProperty("media_type").GetString());
        Assert.Equal("base64", document.GetProperty("source").GetProperty("type").GetString());
        Assert.Equal(Convert.ToBase64String(PdfBytes), document.GetProperty("source").GetProperty("data").GetString());
        var prompt = content[1].GetProperty("text").GetString()!;
        Assert.Contains("2026-10-18", prompt);
        Assert.Contains("22222222-2222-2222-2222-222222222222 | Leg 45 | quads", prompt);
        Assert.Contains("DESCANSO", prompt);
    }
}
