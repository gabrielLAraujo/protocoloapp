using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.DailyCheckins;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Sync;

/// <summary>Thin wrappers over the sync endpoints and a builder for daily check-in changes (fictitious values).</summary>
internal static class SyncApi
{
    public const string Entity = "daily_checkin";

    /// <summary>The API's wire format: camelCase envelope, enums as camelCase strings.</summary>
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static Task<HttpResponseMessage> PushRawAsync(HttpClient client, IReadOnlyList<SyncChange> changes) =>
        client.PostAsJsonAsync(new Uri("/api/sync/push", UriKind.Relative), new SyncPushRequest(changes), Json);

    public static async Task<IReadOnlyList<SyncChangeResult>> PushAsync(HttpClient client, params SyncChange[] changes)
    {
        var response = await PushRawAsync(client, changes);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<SyncPushResponse>(Json);
        return body!.Results;
    }

    public static async Task<SyncChangeResult> PushOneAsync(HttpClient client, SyncChange change) =>
        Assert.Single(await PushAsync(client, change));

    public static async Task<SyncPullResponse> PullAsync(HttpClient client, long since, int? limit = null)
    {
        var query = limit is null
            ? string.Create(CultureInfo.InvariantCulture, $"since={since}")
            : string.Create(CultureInfo.InvariantCulture, $"since={since}&limit={limit}");
        var response = await client.GetAsync(new Uri($"/api/sync/pull?{query}", UriKind.Relative));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SyncPullResponse>(Json))!;
    }

    /// <summary>Every record the user has, following <c>NextSince</c> from 0 until <c>HasMore</c> is false.</summary>
    public static async Task<List<SyncRecord>> PullAllAsync(HttpClient client)
    {
        var records = new List<SyncRecord>();
        long since = 0;
        SyncPullResponse page;
        do
        {
            page = await PullAsync(client, since);
            records.AddRange(page.Records);
            since = page.NextSince;
        }
        while (page.HasMore);

        return records;
    }

    public static SyncChange Checkin(
        Guid id,
        DateOnly date,
        DateTimeOffset clientUpdatedAt,
        int sleepQuality = 4,
        string bowel = "normal",
        decimal waterL = 2.5m,
        decimal? weightKg = 80.4m,
        string? note = "Dia tranquilo.",
        int? stress = null,
        int? mood = null) =>
        new(Entity, id, SyncOp.Upsert, Payload(date, sleepQuality, bowel, waterL, weightKg, note, stress, mood), clientUpdatedAt);

    public static SyncChange Delete(Guid id, DateTimeOffset clientUpdatedAt) =>
        new(Entity, id, SyncOp.Delete, null, clientUpdatedAt);

    public static JsonElement Payload(DateOnly date, int sleepQuality = 4, string bowel = "normal", decimal waterL = 2.5m,
        decimal? weightKg = 80.4m, string? note = "Dia tranquilo.", int? stress = null, int? mood = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["date"] = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ["sleep_quality"] = sleepQuality,
            ["bowel"] = bowel,
            ["energy_wake"] = 3,
            ["energy_day"] = 4,
            ["anxiety"] = 2,
            ["water_l"] = waterL,
            ["weight_kg"] = weightKg,
            ["note"] = note,
        };
        // Left out when null: what an app version before the meters sends.
        if (stress is not null)
            payload["stress"] = stress;
        if (mood is not null)
            payload["mood"] = mood;
        return JsonSerializer.SerializeToElement(payload);
    }

    public static async Task<List<DailyCheckin>> RowsAsync(ApiFactory factory, Guid id)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.DailyCheckins.AsNoTracking().Where(c => c.Id == id).ToListAsync();
    }

    /// <summary>A timestamp safely in the past (the server rejects anything beyond now + 5 min).</summary>
    public static DateTimeOffset Past(int minutesAgo = 60) => DateTimeOffset.UtcNow.AddMinutes(-minutesAgo);
}
