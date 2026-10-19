using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Plans;

/// <summary><c>POST /api/plans/drafts</c> (a draft read on the device) and <c>GET /api/plans/extraction</c>.</summary>
[Collection("api")]
public sealed class PlanDraftTests(ApiFactory factory)
{
    private static async Task<JsonElement> ProblemErrorsAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");

    private static async Task<Guid> CreatedIdAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<CreateDraftResponse>(PlanApi.Json))!;
        Assert.NotEqual(Guid.Empty, body.PlanVersionId);
        Assert.Equal($"/api/plans/{body.PlanVersionId}", response.Headers.Location?.ToString());
        return body.PlanVersionId;
    }

    private static Task AddExerciseAsync(PlanApi api, Guid id, string name, params string[] aliases) => api.WithDbAsync(async db =>
    {
        db.Exercises.Add(new Exercise
        {
            Id = id,
            UserId = api.UserId,
            Name = name,
            NormalizedName = ExerciseNames.Normalize(name),
            Aliases = aliases,
            PrimaryMuscleGroup = MuscleGroup.Chest,
            Version = 1,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
            ClientUpdatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return 0;
    });

    [Fact]
    public async Task Valid_workout_draft_links_known_exercises_and_keeps_the_new_ones()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var bench = Guid.NewGuid();
        // "Supino Inclinado C/ Halteres" in the sample normalizes to this name.
        await AddExerciseAsync(api, bench, "Supino inclinado halteres");
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);

        var response = await api.CreateDraftAsync(
            fileId,
            PlanKind.Workout,
            PlanSamples.Workout,
            ["$.days[1].exercises[0].sets", "days[0].name", "days[9].name"],
            [new NewExerciseSuggestion(" Remada Curvada ", MuscleGroup.Back), new NewExerciseSuggestion("Supino Inclinado c/ Halteres", MuscleGroup.Chest)]);

        var id = await CreatedIdAsync(response);
        var plan = await api.GetAsync(id);
        Assert.Equal(PlanStatus.Draft, plan.Status);
        Assert.Equal(PlanKind.Workout, plan.Kind);
        Assert.Equal(fileId, plan.SourceFileId);
        Assert.Null(plan.ExtractionError);
        var days = plan.Document.GetProperty("days");
        Assert.Equal(bench, days[0].GetProperty("exercises")[0].GetProperty("exerciseId").GetGuid());
        Assert.Equal(JsonValueKind.Null, days[1].GetProperty("exercises")[0].GetProperty("exerciseId").ValueKind);
        // Prefix stripped, a path that does not exist dropped.
        Assert.Equal(["days[1].exercises[0].sets", "days[0].name"], plan.LowConfidence);
        // The known exercise is not suggested again.
        var suggestion = Assert.Single(plan.NewExercises);
        Assert.Equal(("Remada Curvada", MuscleGroup.Back), (suggestion.Name, suggestion.Group));

        var stored = await api.WithDbAsync(db => db.PlanVersions.AsNoTracking().SingleAsync(p => p.Id == id));
        Assert.Equal(api.UserId, stored.UserId);
        Assert.True(stored.Version > 0);
        Assert.Equal("local", stored.RawExtraction!.RootElement.GetProperty("source").GetString());
        Assert.Equal(0, factory.Extractor.Calls);
    }

    [Fact]
    public async Task An_unknown_exercise_id_is_dropped_flagged_and_relinked_by_name()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var bench = Guid.NewGuid();
        await AddExerciseAsync(api, bench, "Supino inclinado halteres");
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var document = PlanSamples.Workout.Replace(
            "\"key\":\"bench\",", "\"key\":\"bench\",\"exerciseId\":\"99999999-9999-9999-9999-999999999999\",", StringComparison.Ordinal);
        Assert.Contains("99999999-9999-9999-9999-999999999999", document, StringComparison.Ordinal);

        var id = await CreatedIdAsync(await api.CreateDraftAsync(fileId, PlanKind.Workout, document));

        var plan = await api.GetAsync(id);
        Assert.Equal(bench, plan.Document.GetProperty("days")[0].GetProperty("exercises")[0].GetProperty("exerciseId").GetGuid());
        Assert.Equal(["days[0].exercises[0].exerciseId"], plan.LowConfidence);
    }

    [Fact]
    public async Task Documents_over_the_size_caps_return_400_on_post_and_put()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var days = string.Join(',', Enumerable.Range(0, PlanDocumentRules.MaxDays + 1).Select(i => $$"""{"key":"d{{i}}","name":"Dia","exercises":[]}"""));
        var tooManyDays = $$"""{"days":[{{days}}]}""";

        var post = await api.CreateDraftAsync(fileId, PlanKind.Workout, tooManyDays);
        var draft = await CreatedIdAsync(await api.CreateDraftAsync(fileId, PlanKind.Workout, PlanSamples.Workout));
        var put = await api.PutAsync(draft, tooManyDays);

        Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
        Assert.True((await ProblemErrorsAsync(post)).TryGetProperty("days", out _));
        Assert.Equal(HttpStatusCode.BadRequest, put.StatusCode);
        Assert.True((await ProblemErrorsAsync(put)).TryGetProperty("days", out _));
    }

    [Fact]
    public async Task Too_many_new_exercises_return_400()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var suggestions = Enumerable.Range(0, 501).Select(i => new NewExerciseSuggestion($"Exercício fictício {i}", MuscleGroup.Other)).ToList();

        var response = await api.CreateDraftAsync(fileId, PlanKind.Workout, PlanSamples.Workout, newExercises: suggestions);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ProblemErrorsAsync(response)).TryGetProperty("newExercises", out _));
    }

    [Fact]
    public async Task A_body_over_1_mb_returns_413_on_post_and_put()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var draft = await CreatedIdAsync(await api.CreateDraftAsync(fileId, PlanKind.Workout, PlanSamples.Workout));
        var padding = new string('x', 1024 * 1024);
        var body = $$"""{"fileId":"{{fileId}}","kind":"workout","document":{"days":[],"padding":"{{padding}}"}}""";

        using var postContent = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        using var putContent = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        var post = await api.Client.PostAsync(new Uri("/api/plans/drafts", UriKind.Relative), postContent);
        var put = await api.Client.PutAsync(new Uri($"/api/plans/{draft}", UriKind.Relative), putContent);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, post.StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, put.StatusCode);
    }

    [Fact]
    public async Task An_alias_links_the_exercise_too()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var row = Guid.NewGuid();
        await AddExerciseAsync(api, row, "Remada barra", "Remada curvada");
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);

        var id = await CreatedIdAsync(await api.CreateDraftAsync(fileId, PlanKind.Workout, PlanSamples.Workout, newExercises: [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back)]));

        var plan = await api.GetAsync(id);
        Assert.Equal(row, plan.Document.GetProperty("days")[1].GetProperty("exercises")[0].GetProperty("exerciseId").GetGuid());
        Assert.Empty(plan.NewExercises);
    }

    [Fact]
    public async Task Draft_activates_and_creates_the_new_exercises_with_their_group()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var id = await CreatedIdAsync(await api.CreateDraftAsync(
            fileId, PlanKind.Workout, PlanSamples.Workout, newExercises: [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back)]));

        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(id)).StatusCode);

        var exercises = await api.WithDbAsync(db => db.Exercises.AsNoTracking().Where(e => e.UserId == api.UserId).ToListAsync());
        Assert.Equal(2, exercises.Count);
        Assert.Equal(MuscleGroup.Back, exercises.Single(e => e.NormalizedName == "remada curvada").PrimaryMuscleGroup);
        var active = await api.GetAsync(id);
        Assert.Equal(PlanStatus.Active, active.Status);
        Assert.Empty(active.NewExercises);
    }

    [Fact]
    public async Task Valid_protocol_draft_is_created()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.ProtocolPdf);

        var id = await CreatedIdAsync(await api.CreateDraftAsync(fileId, PlanKind.Protocol, PlanSamples.Protocol, ["updateDate"]));

        var plan = await api.GetAsync(id);
        Assert.Equal(PlanKind.Protocol, plan.Kind);
        Assert.Equal("Fase 1", plan.Document.GetProperty("phaseName").GetString());
        Assert.Equal(["updateDate"], plan.LowConfidence);
        Assert.Empty(plan.NewExercises);
    }

    [Fact]
    public async Task A_draft_with_empty_fields_is_accepted_like_a_put()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);

        var response = await api.CreateDraftAsync(fileId, PlanKind.Workout, """{"days":[{"key":"a","name":"","exercises":[{"key":"e","name":"","sets":[]}]}]}""");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task File_of_another_user_or_missing_returns_404()
    {
        using var owner = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        var fileId = await owner.CreateFileAsync(FileKind.WorkoutPdf);

        Assert.Equal(HttpStatusCode.NotFound, (await other.CreateDraftAsync(fileId, PlanKind.Workout, PlanSamples.Workout)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.CreateDraftAsync(Guid.NewGuid(), PlanKind.Workout, PlanSamples.Workout)).StatusCode);
        Assert.Empty(await other.WithDbAsync(db => db.PlanVersions.Where(p => p.UserId == other.UserId).ToListAsync()));
    }

    [Fact]
    public async Task File_of_the_wrong_kind_returns_400_and_unconfirmed_returns_409()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var workoutFile = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var pending = await api.CreateFileAsync(FileKind.WorkoutPdf, confirmed: false);

        var wrongKind = await api.CreateDraftAsync(workoutFile, PlanKind.Protocol, PlanSamples.Protocol);

        Assert.Equal(HttpStatusCode.BadRequest, wrongKind.StatusCode);
        Assert.True((await ProblemErrorsAsync(wrongKind)).TryGetProperty("fileId", out _));
        Assert.Equal(HttpStatusCode.Conflict, (await api.CreateDraftAsync(pending, PlanKind.Workout, PlanSamples.Workout)).StatusCode);
    }

    [Fact]
    public async Task Invalid_document_returns_400_with_the_field()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);

        var wrongType = await api.CreateDraftAsync(
            fileId, PlanKind.Workout, """{"days":[{"key":"x","name":"d","exercises":[{"key":"e","name":"n","sets":[{"repsMin":"oito","repsMax":10}]}]}]}""");
        var notAnObject = await api.CreateDraftAsync(fileId, PlanKind.Workout, "[]");

        Assert.Equal(HttpStatusCode.BadRequest, wrongType.StatusCode);
        Assert.Equal("application/problem+json", wrongType.Content.Headers.ContentType?.MediaType);
        Assert.True((await ProblemErrorsAsync(wrongType)).TryGetProperty("days[0].exercises[0].sets[0].repsMin", out _));
        Assert.Equal(HttpStatusCode.BadRequest, notAnObject.StatusCode);
        Assert.True((await ProblemErrorsAsync(notAnObject)).TryGetProperty("document", out _));
        Assert.Empty(await api.WithDbAsync(db => db.PlanVersions.Where(p => p.UserId == api.UserId).ToListAsync()));
    }

    [Fact]
    public async Task Invalid_new_exercise_returns_400_with_the_field()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);

        var response = await api.CreateDraftAsync(fileId, PlanKind.Workout, PlanSamples.Workout, newExercises: [new NewExerciseSuggestion("  ", MuscleGroup.Back)]);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ProblemErrorsAsync(response)).TryGetProperty("newExercises[0].name", out _));
    }

    [Fact]
    public async Task Too_many_low_confidence_paths_return_400()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(FileKind.WorkoutPdf);

        var response = await api.CreateDraftAsync(fileId, PlanKind.Workout, PlanSamples.Workout, Enumerable.Repeat("days[0].name", 501).ToList());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await ProblemErrorsAsync(response)).TryGetProperty("lowConfidence", out _));
    }

    [Theory]
    [InlineData("test-key", true)]
    [InlineData("", false)]
    public async Task Extraction_tells_whether_the_ai_is_configured(string apiKey, bool expected)
    {
        using var api = await PlanApi.CreateAsync(factory);
        await using var configured = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.Configure<AnthropicOptions>(o => o.ApiKey = apiKey)));
        using var client = configured.CreateClient();
        client.DefaultRequestHeaders.Authorization = api.Client.DefaultRequestHeaders.Authorization;

        var info = await client.GetFromJsonAsync<PlanExtractionInfo>(new Uri("/api/plans/extraction", UriKind.Relative), PlanApi.Json);

        Assert.Equal(expected, info!.Ai);
    }
}
