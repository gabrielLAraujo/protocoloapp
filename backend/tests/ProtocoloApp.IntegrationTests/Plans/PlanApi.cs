using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Auth;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Plans;

/// <summary>Fictitious plan documents (no real data).</summary>
public static class PlanSamples
{
    public const string Workout = """
        {"rotation":{"type":"sequence","items":["a","b","off"]},
         "days":[
           {"key":"a","name":"Treino A","exercises":[
             {"key":"bench","name":"Supino Inclinado C/ Halteres","sets":[{"repsMin":8,"repsMax":10},{"repsMin":8,"repsMax":10}],"restSeconds":90}]},
           {"key":"b","name":"Treino B","exercises":[
             {"key":"row","name":"Remada Curvada","sets":[{"repsMin":8,"repsMax":12}]}]}]}
        """;

    public const string Protocol = """
        {"phaseName":"Fase 1","updateDate":"2026-11-01",
         "meals":[{"key":"m1","label":"Refeição 1","items":[{"food":"Arroz","grams":100,"alternatives":[]}]}],
         "items":[{"key":"creatine","category":"supplement","name":"Creatina","doseText":"5 g","timing":"any","schedule":{"type":"daily"}}],
         "guidelines":[]}
        """;
}

/// <summary>Helpers shared by the plan tests: users, files in the fake storage, and the plan endpoints.</summary>
internal sealed class PlanApi(ApiFactory factory) : IDisposable
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public HttpClient Client { get; private set; } = null!;

    public Guid UserId { get; private set; }

    public static async Task<PlanApi> CreateAsync(ApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);

        factory.Extractor.Reset();
        var api = new PlanApi(factory);
        var email = AuthApi.NewEmail();
        api.Client = await factory.CreateAuthenticatedClientAsync(email);
        await using var scope = factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        api.UserId = (await users.FindByEmailAsync(email))!.Id;
        return api;
    }

    public async Task<Guid> CreateFileAsync(FileKind kind = FileKind.WorkoutPdf, bool confirmed = true)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var id = Guid.NewGuid();
        var key = $"{UserId}/test/{id}";
        byte[] bytes = [1, 2, 3, 4];
        factory.Storage.Put(key, bytes);
        db.Files.Add(new FileRecord
        {
            Id = id,
            UserId = UserId,
            StorageKey = key,
            ContentType = "application/pdf",
            SizeBytes = bytes.Length,
            Kind = kind,
            Status = confirmed ? FileStatus.Confirmed : FileStatus.Pending,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return id;
    }

    public Task<HttpResponseMessage> ImportAsync(Guid fileId, PlanKind kind) =>
        Client.PostAsJsonAsync(new Uri("/api/plans/import", UriKind.Relative), new ImportPlanRequest(fileId, kind), Json);

    /// <summary>Creates a file and imports it (the fake extractor answers); returns the draft.</summary>
    public async Task<PlanVersionResponse> ImportDraftAsync(PlanKind kind = PlanKind.Workout)
    {
        var fileId = await CreateFileAsync(kind == PlanKind.Workout ? FileKind.WorkoutPdf : FileKind.ProtocolPdf);
        var response = await ImportAsync(fileId, kind);
        Assert.Equal(System.Net.HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<PlanVersionResponse>(Json))!;
    }

    /// <summary>A draft read on the device: <c>POST /api/plans/drafts</c>.</summary>
    public Task<HttpResponseMessage> CreateDraftAsync(
        Guid fileId,
        PlanKind kind,
        string documentJson,
        IReadOnlyList<string>? lowConfidence = null,
        IReadOnlyList<ProtocoloApp.Api.Features.Plans.Extraction.NewExerciseSuggestion>? newExercises = null)
    {
        using var document = JsonDocument.Parse(documentJson);
        return Client.PostAsJsonAsync(
            new Uri("/api/plans/drafts", UriKind.Relative),
            new CreateDraftRequest(fileId, kind, document.RootElement.Clone(), lowConfidence, newExercises),
            Json);
    }

    public Task<HttpResponseMessage> ActivateAsync(Guid id, DateOnly? cycleStart = null) =>
        Client.PostAsJsonAsync(new Uri($"/api/plans/{id}/activate", UriKind.Relative), new ActivatePlanRequest(cycleStart), Json);

    public Task<HttpResponseMessage> PutAsync(Guid id, string documentJson, IReadOnlyList<ProtocoloApp.Api.Features.Plans.Extraction.NewExerciseSuggestion>? newExercises = null)
    {
        using var document = JsonDocument.Parse(documentJson);
        return Client.PutAsJsonAsync(new Uri($"/api/plans/{id}", UriKind.Relative), new UpdatePlanRequest(document.RootElement.Clone(), newExercises), Json);
    }

    public async Task<PlanVersionResponse> GetAsync(Guid id)
    {
        var response = await Client.GetAsync(new Uri($"/api/plans/{id}", UriKind.Relative));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<PlanVersionResponse>(Json))!;
    }

    public async Task<T> WithDbAsync<T>(Func<AppDbContext, Task<T>> action)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    public void Dispose() => Client.Dispose();
}
