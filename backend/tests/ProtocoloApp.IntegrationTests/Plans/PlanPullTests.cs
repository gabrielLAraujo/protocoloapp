using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Auth;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Plans;

[Collection("api")]
public sealed class PlanPullTests(ApiFactory factory)
{
    private async Task<(HttpClient Client, Guid UserId)> NewUserAsync()
    {
        var email = AuthApi.NewEmail();
        var client = await factory.CreateAuthenticatedClientAsync(email);
        await using var scope = factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.Identity.UserManager<AppUser>>();
        return (client, (await users.FindByEmailAsync(email))!.Id);
    }

    private async Task<Guid> InsertPlanAsync(Guid userId, PlanKind kind, PlanStatus status, string documentJson)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var fileId = Guid.NewGuid();
        db.Files.Add(new FileRecord
        {
            Id = fileId,
            UserId = userId,
            StorageKey = $"{userId}/test/{fileId}",
            ContentType = "application/pdf",
            SizeBytes = 10,
            Kind = FileKind.WorkoutPdf,
            Status = FileStatus.Confirmed,
            CreatedAt = DateTimeOffset.UtcNow,
        });

        var plan = new PlanVersion
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Kind = kind,
            Status = status,
            SourceFileId = fileId,
            Document = JsonDocument.Parse(documentJson),
            RawExtraction = JsonDocument.Parse("""{"secret":"raw"}"""),
            LowConfidence = ["days[0].name"],
            ActivatedAt = status == PlanStatus.Active ? DateTimeOffset.UtcNow : null,
        };

        await using var transaction = await db.Database.BeginTransactionAsync();
        await SyncWrites.StampAsync(db, plan, userId, TimeProvider.System);
        db.PlanVersions.Add(plan);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return plan.Id;
    }

    [Fact]
    public async Task Plan_version_is_pulled_without_raw_extraction()
    {
        var (client, userId) = await NewUserAsync();
        using var c = client;
        var id = await InsertPlanAsync(userId, PlanKind.Workout, PlanStatus.Draft, """{"rotation":{"type":"sequence","items":["A"]},"days":[]}""");

        var records = await SyncApi.PullAllAsync(client);

        var record = Assert.Single(records, r => r.Entity == "plan_version");
        Assert.Equal(id, record.Id);
        var payload = record.Payload!.Value;
        Assert.Equal("workout", payload.GetProperty("kind").GetString());
        Assert.Equal("draft", payload.GetProperty("status").GetString());
        Assert.Equal("sequence", payload.GetProperty("document").GetProperty("rotation").GetProperty("type").GetString());
        Assert.Equal("days[0].name", payload.GetProperty("low_confidence")[0].GetString());
        Assert.False(payload.TryGetProperty("raw_extraction", out _));
        Assert.DoesNotContain("secret", payload.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Plan_version_of_another_user_is_not_pulled()
    {
        var (alice, aliceId) = await NewUserAsync();
        var (bob, _) = await NewUserAsync();
        using var a = alice;
        using var b = bob;
        await InsertPlanAsync(aliceId, PlanKind.Protocol, PlanStatus.Active, "{}");

        Assert.DoesNotContain(await SyncApi.PullAllAsync(bob), r => r.Entity == "plan_version");
        Assert.Contains(await SyncApi.PullAllAsync(alice), r => r.Entity == "plan_version");
    }

    [Fact]
    public async Task Pushing_a_plan_version_is_rejected_as_read_only()
    {
        var (client, userId) = await NewUserAsync();
        using var c = client;
        var id = await InsertPlanAsync(userId, PlanKind.Workout, PlanStatus.Draft, "{}");
        var payload = JsonSerializer.SerializeToElement(new { kind = "workout", status = "active", document = new { } });

        var result = await SyncApi.PushOneAsync(client, new SyncChange("plan_version", id, SyncOp.Upsert, payload, SyncApi.Past()));

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal("read_only", Assert.Single(result.Errors!));
    }

    [Fact]
    public async Task Pushing_a_new_exercise_is_rejected_as_read_only()
    {
        var (client, _) = await NewUserAsync();
        using var c = client;
        var payload = JsonSerializer.SerializeToElement(new { name = "Leg 45" });

        var result = await SyncApi.PushOneAsync(client, new SyncChange("exercise", Guid.NewGuid(), SyncOp.Upsert, payload, SyncApi.Past()));

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal("read_only", Assert.Single(result.Errors!));
    }

    [Fact]
    public async Task Exercise_is_pulled_with_snake_case_payload()
    {
        var (client, userId) = await NewUserAsync();
        using var c = client;
        var id = Guid.NewGuid();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var exercise = new Exercise
            {
                Id = id,
                UserId = userId,
                Name = "Supino inclinado c/ halteres",
                NormalizedName = ExerciseNames.Normalize("Supino inclinado c/ halteres"),
                PrimaryMuscleGroup = MuscleGroup.Chest,
                Aliases = ["supino inc"],
            };
            await using var transaction = await db.Database.BeginTransactionAsync();
            await SyncWrites.StampAsync(db, exercise, userId, TimeProvider.System);
            db.Exercises.Add(exercise);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
        }

        var record = Assert.Single(await SyncApi.PullAllAsync(client), r => r.Entity == "exercise");

        Assert.Equal(id, record.Id);
        var payload = record.Payload!.Value;
        Assert.Equal("Supino inclinado c/ halteres", payload.GetProperty("name").GetString());
        Assert.Equal("chest", payload.GetProperty("primary_muscle_group").GetString());
        Assert.Equal("supino inclinado halteres", payload.GetProperty("normalized_name").GetString());
        Assert.Equal("supino inc", payload.GetProperty("aliases")[0].GetString());
    }

    [Fact]
    public async Task Only_one_active_plan_per_kind_is_allowed()
    {
        var (client, userId) = await NewUserAsync();
        using var c = client;
        await InsertPlanAsync(userId, PlanKind.Workout, PlanStatus.Active, "{}");

        await Assert.ThrowsAnyAsync<Exception>(() => InsertPlanAsync(userId, PlanKind.Workout, PlanStatus.Active, "{}"));
        await InsertPlanAsync(userId, PlanKind.Protocol, PlanStatus.Active, "{}");
        await InsertPlanAsync(userId, PlanKind.Workout, PlanStatus.Archived, "{}");
    }
}
