using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Integrations.Hevy;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;

namespace ProtocoloApp.IntegrationTests.Integrations;

/// <summary>Fictitious Hevy data shared by the sync and exercise tests: a user with an active plan since March 1, 2026.</summary>
internal static class HevyTestData
{
    public static readonly Uri Url = new("/api/integrations/hevy", UriKind.Relative);

    public static readonly Uri SyncUrl = new("/api/integrations/hevy/sync", UriKind.Relative);

    public static readonly DateOnly SyncFrom = new(2026, 3, 5);

    public const string MatchedTemplate = "TPL-TEST-01";
    public const string UnknownTemplate = "TPL-TEST-99";
    public const string UnknownTitle = "Exercicio Inventado Hevy";

    private static int _keyCounter;

    /// <summary>A fictitious key, distinct per call so the fake's per-key answers do not leak between tests.</summary>
    public static string NewKey() => $"test-key-0000-0000-0001-{Interlocked.Increment(ref _keyCounter):D12}";

    public static string NewId() => $"hevy-test-{Guid.NewGuid():N}";

    /// <summary>A user whose workout plan is active since March 1 (the workouts below are in March); returns the curl's id.</summary>
    public static async Task<(PlanApi Api, Guid CurlId)> UserWithPlanAsync(ApiFactory factory)
    {
        var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync();
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id)).StatusCode);
        await api.WithDbAsync(async db =>
        {
            var plan = await db.PlanVersions.SingleAsync(p => p.Id == draft.Id);
            plan.ActivatedAt = new DateTimeOffset(2026, 3, 1, 12, 0, 0, TimeSpan.Zero);
            return await db.SaveChangesAsync();
        });
        var curl = await api.WithDbAsync(db => db.Exercises.AsNoTracking()
            .SingleAsync(e => e.UserId == api.UserId && e.NormalizedName == ExerciseNames.Normalize("Rosca Alternada C/ Halteres")));
        return (api, curl.Id);
    }

    /// <summary>Connects <paramref name="key"/> with <see cref="SyncFrom"/> as the start date.</summary>
    public static async Task ConnectAsync(PlanApi api, string key)
    {
        var response = await api.Client.PutAsJsonAsync(Url, new { apiKey = key, syncFrom = SyncFrom }, PlanApi.Json);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>A workout on the local date <paramref name="day"/> of March 2026 at 10:00 São Paulo, with a matched and an unknown exercise.</summary>
    public static HevyWorkout Workout(int day, string? id = null, DateTimeOffset? updatedAt = null)
    {
        var start = new DateTimeOffset(2026, 3, day, 13, 0, 0, TimeSpan.Zero);
        return new HevyWorkout(id ?? NewId(), "Treino A", null, start, start.AddHours(1), updatedAt ?? start.AddHours(2),
        [
            new HevyExercise("Rosca Alternada (Halteres)", MatchedTemplate, null, null, [new HevySet(0, "normal", 20m, 10, null, null, null)]),
            new HevyExercise(UnknownTitle, UnknownTemplate, null, null, [new HevySet(0, "normal", 30m, 12, null, null, null)]),
        ]);
    }

    /// <summary>Pages of workouts as the fake serves them; pages past the list are empty. <paramref name="pageCount"/> is what Hevy claims.</summary>
    public static Func<int, HevyResult<HevyPage<HevyWorkout>>> Pages(int pageCount, params HevyWorkout[][] pages) =>
        page => HevyResult<HevyPage<HevyWorkout>>.Ok(new HevyPage<HevyWorkout>(page <= pages.Length ? pages[page - 1] : [], page, pageCount, 0));
}
