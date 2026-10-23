using System.Text.Json;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.DietDeviations;

public sealed class DietDeviationSyncTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Entity = "diet_deviation";

    private static SyncChange Deviation(
        Guid id,
        string description = "Biscoito",
        string? mealKey = "1",
        string? time = null,
        string? quantity = "2 unidades",
        int minutesAgo = 60) =>
        new(Entity, id, SyncOp.Upsert, JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["date"] = "2026-03-10",
            ["meal_key"] = mealKey,
            ["time"] = time,
            ["description"] = description,
            ["quantity"] = quantity,
        }), SyncApi.Past(minutesAgo));

    private static void AssertRejected(SyncChangeResult result, string error)
    {
        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { error }, result.Errors);
    }

    private async Task<PlanApi> NewUserAsync() => await PlanApi.CreateAsync(factory);

    [Fact]
    public async Task Deviations_roundtrip_inside_a_meal_and_as_an_extra_meal()
    {
        using var api = await NewUserAsync();
        var inMeal = Guid.NewGuid();
        var second = Guid.NewGuid();
        var extra = Guid.NewGuid();

        var results = await SyncApi.PushAsync(
            api.Client,
            Deviation(inMeal),
            Deviation(second, description: "Refrigerante", quantity: null),
            Deviation(extra, description: "Pizza", mealKey: null, time: "21:15", quantity: "2 fatias"));

        Assert.All(results, r => Assert.Equal(SyncResultStatus.Applied, r.Status));
        var records = (await SyncApi.PullAllAsync(api.Client)).Where(r => r.Entity == Entity).ToList();
        Assert.Equal(3, records.Count);
        var m = records.Single(r => r.Id == inMeal).Payload!.Value;
        Assert.Equal("2026-03-10", m.GetProperty("date").GetString());
        Assert.Equal("1", m.GetProperty("meal_key").GetString());
        Assert.Equal(JsonValueKind.Null, m.GetProperty("time").ValueKind);
        Assert.Equal("Biscoito", m.GetProperty("description").GetString());
        Assert.Equal("2 unidades", m.GetProperty("quantity").GetString());
        Assert.Equal(JsonValueKind.Null, records.Single(r => r.Id == second).Payload!.Value.GetProperty("quantity").ValueKind);
        var e = records.Single(r => r.Id == extra).Payload!.Value;
        Assert.Equal(JsonValueKind.Null, e.GetProperty("meal_key").ValueKind);
        Assert.Equal("21:15", e.GetProperty("time").GetString());
    }

    [Fact]
    public async Task Edit_and_delete_reach_the_pull()
    {
        using var api = await NewUserAsync();
        var id = Guid.NewGuid();
        await SyncApi.PushAsync(api.Client, Deviation(id, minutesAgo: 60));

        var edit = await SyncApi.PushOneAsync(api.Client, Deviation(id, description: "Chocolate", quantity: "1 barra", minutesAgo: 30));
        var edited = (await SyncApi.PullAllAsync(api.Client)).Single(r => r.Id == id);
        var delete = await SyncApi.PushOneAsync(api.Client, new SyncChange(Entity, id, SyncOp.Delete, null, SyncApi.Past(10)));
        var deleted = (await SyncApi.PullAsync(api.Client, edited.Version)).Records.Single(r => r.Id == id);

        Assert.Equal(SyncResultStatus.Applied, edit.Status);
        Assert.Equal("Chocolate", edited.Payload!.Value.GetProperty("description").GetString());
        Assert.Equal(SyncResultStatus.Applied, delete.Status);
        Assert.NotNull(deleted.DeletedAt);
    }

    [Fact]
    public async Task Older_change_is_stale()
    {
        using var api = await NewUserAsync();
        var id = Guid.NewGuid();
        await SyncApi.PushAsync(api.Client, Deviation(id, minutesAgo: 30));

        var stale = await SyncApi.PushOneAsync(api.Client, Deviation(id, description: "Antigo", minutesAgo: 120));

        Assert.Equal(SyncResultStatus.Stale, stale.Status);
        var record = (await SyncApi.PullAllAsync(api.Client)).Single(r => r.Id == id);
        Assert.Equal("Biscoito", record.Payload!.Value.GetProperty("description").GetString());
    }

    [Theory]
    [InlineData("description", "   ")]
    [InlineData("time", "7:00")]
    [InlineData("meal_key", "has space")]
    public async Task Invalid_fields_are_rejected(string field, string value)
    {
        using var api = await NewUserAsync();
        var payload = new Dictionary<string, object?>
        {
            ["date"] = "2026-03-10",
            ["meal_key"] = "1",
            ["description"] = "Biscoito",
            [field] = value,
        };

        var result = await SyncApi.PushOneAsync(
            api.Client,
            new SyncChange(Entity, Guid.NewGuid(), SyncOp.Upsert, JsonSerializer.SerializeToElement(payload), SyncApi.Past(60)));

        AssertRejected(result, $"invalid_payload:{field}");
    }

    [Fact]
    public async Task Length_limits()
    {
        using var api = await NewUserAsync();

        var d200 = await SyncApi.PushOneAsync(api.Client, Deviation(Guid.NewGuid(), description: new string('x', 200)));
        var d201 = await SyncApi.PushOneAsync(api.Client, Deviation(Guid.NewGuid(), description: new string('x', 201)));
        var q60 = await SyncApi.PushOneAsync(api.Client, Deviation(Guid.NewGuid(), quantity: new string('q', 60)));
        var q61 = await SyncApi.PushOneAsync(api.Client, Deviation(Guid.NewGuid(), quantity: new string('q', 61)));

        Assert.Equal(SyncResultStatus.Applied, d200.Status);
        AssertRejected(d201, "invalid_payload:description");
        Assert.Equal(SyncResultStatus.Applied, q60.Status);
        AssertRejected(q61, "invalid_payload:quantity");
    }

    [Fact]
    public async Task Another_users_id_is_forbidden()
    {
        using var owner = await NewUserAsync();
        using var other = await NewUserAsync();
        var id = Guid.NewGuid();
        await SyncApi.PushAsync(owner.Client, Deviation(id));

        var result = await SyncApi.PushOneAsync(other.Client, Deviation(id));

        AssertRejected(result, "forbidden");
    }
}
