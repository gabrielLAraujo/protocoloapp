using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Plans.Extraction;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Plans;

[Collection("api")]
public sealed class PlanImportTests(ApiFactory factory)
{
    [Fact]
    public async Task Import_creates_a_draft_with_the_extracted_document()
    {
        using var api = await PlanApi.CreateAsync(factory);
        factory.Extractor.Handler = (_, _, _, _) => Task.FromResult(FakePlanExtractor.Success(
            PlanSamples.Workout, [new NewExerciseSuggestion("Remada Curvada", MuscleGroup.Back)], ["days[0].name"]));
        var fileId = await api.CreateFileAsync();

        var response = await api.ImportAsync(fileId, PlanKind.Workout);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var plan = (await response.Content.ReadFromJsonAsync<PlanVersionResponse>(PlanApi.Json))!;
        Assert.Equal(PlanStatus.Draft, plan.Status);
        Assert.Equal(PlanKind.Workout, plan.Kind);
        Assert.Equal(fileId, plan.SourceFileId);
        Assert.Null(plan.ExtractionError);
        Assert.Null(plan.ActivatedAt);
        Assert.Equal("sequence", plan.Document.GetProperty("rotation").GetProperty("type").GetString());
        Assert.Equal(2, plan.Document.GetProperty("days").GetArrayLength());
        Assert.Equal(["days[0].name"], plan.LowConfidence);
        var suggestion = Assert.Single(plan.NewExercises);
        Assert.Equal(("Remada Curvada", MuscleGroup.Back), (suggestion.Name, suggestion.Group));
        Assert.Equal(1, factory.Extractor.Calls);
        Assert.Equal(new byte[] { 1, 2, 3, 4 }, factory.Extractor.LastPdf);

        var stored = await api.WithDbAsync(db => db.PlanVersions.AsNoTracking().SingleAsync(p => p.Id == plan.Id));
        Assert.NotNull(stored.RawExtraction);
        Assert.True(stored.Version > 0);
        Assert.Equal(api.UserId, stored.UserId);
    }

    [Fact]
    public async Task Import_passes_the_users_catalog_to_the_extractor()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var known = Guid.NewGuid();
        await api.WithDbAsync(async db =>
        {
            db.Exercises.Add(new Exercise { Id = known, UserId = api.UserId, Name = "Agachamento", NormalizedName = "agachamento", Version = 1, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow, ClientUpdatedAt = DateTimeOffset.UtcNow });
            db.Exercises.Add(new Exercise { Id = Guid.NewGuid(), UserId = api.UserId, Name = "Removido", NormalizedName = "removido", Version = 2, DeletedAt = DateTimeOffset.UtcNow, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow, ClientUpdatedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
            return 0;
        });

        await api.ImportDraftAsync();

        var hint = Assert.Single(factory.Extractor.LastKnown);
        Assert.Equal(known, hint.Id);
    }

    [Theory]
    [InlineData(PlanExtractionResult.Timeout)]
    [InlineData(PlanExtractionResult.InvalidExtraction)]
    [InlineData(PlanExtractionResult.TooLong)]
    public async Task Extraction_errors_create_an_empty_draft_with_the_error(string error)
    {
        using var api = await PlanApi.CreateAsync(factory);
        factory.Extractor.Handler = (_, _, _, _) => Task.FromResult(PlanExtractionResult.Failure(error));

        var workout = await api.ImportDraftAsync(PlanKind.Workout);
        var protocol = await api.ImportDraftAsync(PlanKind.Protocol);

        Assert.Equal(error, workout.ExtractionError);
        Assert.Equal(PlanStatus.Draft, workout.Status);
        Assert.Equal(0, workout.Document.GetProperty("days").GetArrayLength());
        Assert.Equal(error, protocol.ExtractionError);
        Assert.Equal(0, protocol.Document.GetProperty("meals").GetArrayLength());
        Assert.Empty(workout.NewExercises);
    }

    [Fact]
    public async Task An_invalid_extraction_keeps_the_pdf_attached_to_the_empty_draft()
    {
        using var api = await PlanApi.CreateAsync(factory);
        factory.Extractor.Handler = (_, _, _, _) => Task.FromResult(PlanExtractionResult.Failure(PlanExtractionResult.InvalidExtraction));
        var fileId = await api.CreateFileAsync();

        var response = await api.ImportAsync(fileId, PlanKind.Workout);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var draft = (await response.Content.ReadFromJsonAsync<PlanVersionResponse>(PlanApi.Json))!;
        Assert.Equal(PlanExtractionResult.InvalidExtraction, draft.ExtractionError);
        Assert.Equal(fileId, draft.SourceFileId);
        var file = await api.WithDbAsync(db => db.Files.AsNoTracking().SingleAsync(f => f.Id == fileId));
        Assert.Equal(FileStatus.Confirmed, file.Status);
    }

    [Fact]
    public async Task An_empty_draft_can_be_filled_in_and_activated()
    {
        using var api = await PlanApi.CreateAsync(factory);
        factory.Extractor.Handler = (_, _, _, _) => Task.FromResult(PlanExtractionResult.Failure(PlanExtractionResult.InvalidExtraction));
        var draft = await api.ImportDraftAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await api.ActivateAsync(draft.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.PutAsync(draft.Id, PlanSamples.Workout)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id)).StatusCode);
    }

    [Fact]
    public async Task Unavailable_extractor_returns_503()
    {
        using var api = await PlanApi.CreateAsync(factory);
        factory.Extractor.Handler = (_, _, _, _) => Task.FromResult(PlanExtractionResult.Failure(PlanExtractionResult.Unavailable));
        var fileId = await api.CreateFileAsync();

        var response = await api.ImportAsync(fileId, PlanKind.Workout);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("Importação indisponível", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString());
        Assert.Empty(await api.WithDbAsync(db => db.PlanVersions.Where(p => p.UserId == api.UserId).ToListAsync()));
    }

    [Fact]
    public async Task Too_large_pdf_returns_413()
    {
        using var api = await PlanApi.CreateAsync(factory);
        factory.Extractor.Handler = (_, _, _, _) => Task.FromResult(PlanExtractionResult.Failure(PlanExtractionResult.TooLarge));
        var fileId = await api.CreateFileAsync();

        var response = await api.ImportAsync(fileId, PlanKind.Workout);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("PDF grande demais (máx. 20 MB)", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString());
    }

    [Fact]
    public async Task File_of_another_user_or_missing_returns_404()
    {
        using var owner = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        var fileId = await owner.CreateFileAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await other.ImportAsync(fileId, PlanKind.Workout)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.ImportAsync(Guid.NewGuid(), PlanKind.Workout)).StatusCode);
        Assert.Equal(0, factory.Extractor.Calls);
    }

    [Fact]
    public async Task File_of_the_wrong_kind_returns_400()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var workoutFile = await api.CreateFileAsync(FileKind.WorkoutPdf);
        var photo = await api.CreateFileAsync(FileKind.Photo);

        Assert.Equal(HttpStatusCode.BadRequest, (await api.ImportAsync(workoutFile, PlanKind.Protocol)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.ImportAsync(photo, PlanKind.Workout)).StatusCode);
        Assert.Equal(0, factory.Extractor.Calls);
    }

    [Fact]
    public async Task Unconfirmed_file_returns_409()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = await api.CreateFileAsync(confirmed: false);

        Assert.Equal(HttpStatusCode.Conflict, (await api.ImportAsync(fileId, PlanKind.Workout)).StatusCode);
    }

    [Fact]
    public async Task File_missing_from_the_storage_returns_409()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var fileId = Guid.NewGuid();
        await api.WithDbAsync(async db =>
        {
            db.Files.Add(new FileRecord
            {
                Id = fileId,
                UserId = api.UserId,
                StorageKey = $"{api.UserId}/test/never-uploaded-{fileId}",
                ContentType = "application/pdf",
                SizeBytes = 5,
                Kind = FileKind.WorkoutPdf,
                Status = FileStatus.Confirmed,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
            return 0;
        });

        Assert.Equal(HttpStatusCode.Conflict, (await api.ImportAsync(fileId, PlanKind.Workout)).StatusCode);
    }

    [Fact]
    public async Task Import_stops_at_the_total_timeout_and_keeps_a_draft()
    {
        using var api = await PlanApi.CreateAsync(factory);
        factory.Extractor.Handler = async (_, _, _, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            return PlanExtractionResult.Failure(PlanExtractionResult.Unavailable);
        };
        var fileId = await api.CreateFileAsync();

        await using var shortTimeout = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services => services.Configure<AnthropicOptions>(o => o.TotalTimeout = TimeSpan.FromMilliseconds(200))));
        using var client = shortTimeout.CreateClient();
        client.DefaultRequestHeaders.Authorization = api.Client.DefaultRequestHeaders.Authorization;

        var response = await client.PostAsJsonAsync(new Uri("/api/plans/import", UriKind.Relative), new ImportPlanRequest(fileId, PlanKind.Workout), PlanApi.Json);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var plan = (await response.Content.ReadFromJsonAsync<PlanVersionResponse>(PlanApi.Json))!;
        Assert.Equal(PlanExtractionResult.Timeout, plan.ExtractionError);
    }

    [Fact]
    public async Task Plan_of_another_user_is_a_404()
    {
        using var owner = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        var draft = await owner.ImportDraftAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await other.Client.GetAsync(new Uri($"/api/plans/{draft.Id}", UriKind.Relative))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.PutAsync(draft.Id, PlanSamples.Workout)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.ActivateAsync(draft.Id)).StatusCode);
    }

    [Fact]
    public async Task List_filters_by_kind_and_status()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var workout = await api.ImportDraftAsync(PlanKind.Workout);
        var protocol = await api.ImportDraftAsync(PlanKind.Protocol);
        await api.ActivateAsync(protocol.Id);

        var all = await api.Client.GetFromJsonAsync<List<PlanVersionSummary>>(new Uri("/api/plans", UriKind.Relative), PlanApi.Json);
        var drafts = await api.Client.GetFromJsonAsync<List<PlanVersionSummary>>(new Uri("/api/plans?status=draft", UriKind.Relative), PlanApi.Json);
        var protocols = await api.Client.GetFromJsonAsync<List<PlanVersionSummary>>(new Uri("/api/plans?kind=protocol", UriKind.Relative), PlanApi.Json);

        Assert.Equal(2, all!.Count);
        Assert.Equal(workout.Id, Assert.Single(drafts!).Id);
        Assert.Equal(protocol.Id, Assert.Single(protocols!).Id);
        Assert.Equal(HttpStatusCode.BadRequest, (await api.Client.GetAsync(new Uri("/api/plans?kind=nope", UriKind.Relative))).StatusCode);
    }
}
