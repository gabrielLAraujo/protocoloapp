using System.Net;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Auth;
using ProtocoloApp.IntegrationTests.Infra;

namespace ProtocoloApp.IntegrationTests.Sync;

[Collection("api")]
public sealed class PushTests(ApiFactory factory)
{
    private static readonly DateOnly Day = new(2026, 3, 10);

    private Task<HttpClient> NewUserAsync() => factory.CreateAuthenticatedClientAsync(AuthApi.NewEmail());

    [Fact]
    public async Task Upsert_new_record_is_applied_and_gets_version()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        var result = await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, SyncApi.Past()));

        Assert.Equal(id, result.Id);
        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var record = Assert.Single((await SyncApi.PullAsync(client, 0)).Records);
        Assert.Equal(id, record.Id);
        Assert.Equal(SyncApi.Entity, record.Entity);
        Assert.True(record.Version > 0);
        Assert.Null(record.DeletedAt);
        var payload = record.Payload!.Value;
        Assert.Equal("2026-03-10", payload.GetProperty("date").GetString());
        Assert.Equal(4, payload.GetProperty("sleep_quality").GetInt32());
        Assert.Equal("normal", payload.GetProperty("bowel").GetString());
        Assert.Equal(2.5m, payload.GetProperty("water_l").GetDecimal());
        Assert.Equal(80.4m, payload.GetProperty("weight_kg").GetDecimal());
    }

    [Fact]
    public async Task Same_change_twice_is_idempotent()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();
        // Full tick precision and a non-UTC offset: the server must store and compare it exactly (Postgres keeps microseconds).
        var at = SyncApi.Past().AddTicks(7).ToOffset(TimeSpan.FromHours(-3));
        var change = SyncApi.Checkin(id, Day, at);

        var first = await SyncApi.PushOneAsync(client, change);
        var versionAfterFirst = Assert.Single(await SyncApi.RowsAsync(factory, id)).Version;
        var second = await SyncApi.PushOneAsync(client, change);

        Assert.Equal(SyncResultStatus.Applied, first.Status);
        Assert.Equal(SyncResultStatus.Stale, second.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Equal(versionAfterFirst, row.Version);
    }

    [Fact]
    public async Task Older_change_is_stale()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();
        var t2 = SyncApi.Past(10);
        var t1 = t2.AddMinutes(-5);

        var newer = await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, t2, sleepQuality: 5));
        var older = await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, t1, sleepQuality: 1));

        Assert.Equal(SyncResultStatus.Applied, newer.Status);
        Assert.Equal(SyncResultStatus.Stale, older.Status);
        var record = Assert.Single((await SyncApi.PullAsync(client, 0)).Records);
        Assert.Equal(5, record.Payload!.Value.GetProperty("sleep_quality").GetInt32());
    }

    [Fact]
    public async Task Newer_change_overwrites_and_bumps_version()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();
        var t1 = SyncApi.Past(10);

        await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, t1, sleepQuality: 2));
        var v1 = Assert.Single(await SyncApi.RowsAsync(factory, id)).Version;
        var result = await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, t1.AddMinutes(1), sleepQuality: 3, weightKg: 81.2m));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.True(row.Version > v1);
        Assert.Equal(3, row.SleepQuality);
        Assert.Equal(81.2m, row.WeightKg);
    }

    [Fact]
    public async Task Future_timestamp_is_rejected()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        var result = await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, DateTimeOffset.UtcNow.AddMinutes(6)));

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Contains(result.Errors!, e => e.Contains("client_updated_at", StringComparison.Ordinal));
        Assert.Empty(await SyncApi.RowsAsync(factory, id));
    }

    [Fact]
    public async Task Timestamp_within_tolerance_is_applied()
    {
        using var client = await NewUserAsync();

        var result = await SyncApi.PushOneAsync(client, SyncApi.Checkin(Guid.NewGuid(), Day, DateTimeOffset.UtcNow.AddMinutes(4)));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
    }

    [Fact]
    public async Task Mixed_batch_applies_valid_and_rejects_invalid()
    {
        using var client = await NewUserAsync();
        var valid = SyncApi.Checkin(Guid.NewGuid(), Day, SyncApi.Past());
        var invalid = SyncApi.Checkin(Guid.NewGuid(), Day.AddDays(1), SyncApi.Past(), sleepQuality: 9);
        var unknown = valid with { Entity = "unknown", Id = Guid.NewGuid() };

        var results = await SyncApi.PushAsync(client, valid, invalid, unknown);

        Assert.Equal(new[] { valid.Id, invalid.Id, unknown.Id }, results.Select(r => r.Id));
        Assert.Equal(
            new[] { SyncResultStatus.Applied, SyncResultStatus.Rejected, SyncResultStatus.Rejected },
            results.Select(r => r.Status));
        Assert.Null(results[0].Errors);
        Assert.Contains("invalid_payload:sleep_quality", results[1].Errors!);
        Assert.Contains("unknown_entity", results[2].Errors!);
        Assert.Single(await SyncApi.RowsAsync(factory, valid.Id));
        Assert.Empty(await SyncApi.RowsAsync(factory, invalid.Id));
    }

    [Fact]
    public async Task Upsert_without_payload_is_rejected()
    {
        using var client = await NewUserAsync();
        var change = SyncApi.Checkin(Guid.NewGuid(), Day, SyncApi.Past()) with { Payload = null };

        var result = await SyncApi.PushOneAsync(client, change);

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Contains("invalid_payload", result.Errors!);
    }

    [Fact]
    public async Task Batch_over_500_returns_400()
    {
        using var client = await NewUserAsync();
        var changes = Enumerable.Range(0, 501)
            .Select(i => SyncApi.Checkin(Guid.NewGuid(), Day.AddDays(i), SyncApi.Past()))
            .ToList();

        var response = await SyncApi.PushRawAsync(client, changes);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Batch_of_500_is_accepted()
    {
        using var client = await NewUserAsync();
        var changes = Enumerable.Range(0, 500)
            .Select(i => SyncApi.Checkin(Guid.NewGuid(), Day.AddDays(i), SyncApi.Past()))
            .ToList();

        var response = await SyncApi.PushRawAsync(client, changes);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Same_date_different_id_is_rejected()
    {
        using var client = await NewUserAsync();
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, SyncApi.Checkin(first, Day, SyncApi.Past(10)));
        var result = await SyncApi.PushOneAsync(client, SyncApi.Checkin(second, Day, SyncApi.Past(5)));

        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Contains("date_conflict", result.Errors!);
        Assert.Empty(await SyncApi.RowsAsync(factory, second));
    }

    [Fact]
    public async Task Deleting_frees_the_date_for_another_id()
    {
        using var client = await NewUserAsync();
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, SyncApi.Checkin(first, Day, SyncApi.Past(10)));
        await SyncApi.PushOneAsync(client, SyncApi.Delete(first, SyncApi.Past(9)));
        var result = await SyncApi.PushOneAsync(client, SyncApi.Checkin(second, Day, SyncApi.Past(8)));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
    }

    [Fact]
    public async Task Delete_sets_deleted_at_and_bumps_version()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, SyncApi.Past(10)));
        var versionBefore = Assert.Single(await SyncApi.RowsAsync(factory, id)).Version;
        var result = await SyncApi.PushOneAsync(client, SyncApi.Delete(id, SyncApi.Past(5)));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.NotNull(row.DeletedAt);
        Assert.True(row.Version > versionBefore);
        var record = Assert.Single((await SyncApi.PullAsync(client, versionBefore)).Records);
        Assert.Equal(id, record.Id);
        Assert.NotNull(record.DeletedAt);
        Assert.Null(record.Payload);
    }

    [Fact]
    public async Task Upsert_older_than_delete_is_stale_and_record_stays_deleted()
    {
        using var client = await NewUserAsync();
        var id = Guid.NewGuid();
        var t2 = SyncApi.Past(5);
        var t1 = t2.AddMinutes(-1);

        await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, t2.AddMinutes(-10)));
        Assert.Equal(SyncResultStatus.Applied, (await SyncApi.PushOneAsync(client, SyncApi.Delete(id, t2))).Status);
        var result = await SyncApi.PushOneAsync(client, SyncApi.Checkin(id, Day, t1, sleepQuality: 1));

        Assert.Equal(SyncResultStatus.Stale, result.Status);
        var record = Assert.Single(await SyncApi.PullAllAsync(client));
        Assert.Equal(id, record.Id);
        Assert.NotNull(record.DeletedAt);
        Assert.Null(record.Payload);
        Assert.NotNull(Assert.Single(await SyncApi.RowsAsync(factory, id)).DeletedAt);
    }

    [Fact]
    public async Task Other_user_cannot_overwrite_record()
    {
        using var owner = await NewUserAsync();
        using var intruder = await NewUserAsync();
        var id = Guid.NewGuid();

        await SyncApi.PushOneAsync(owner, SyncApi.Checkin(id, Day, SyncApi.Past(10), sleepQuality: 2));
        var overwrite = await SyncApi.PushOneAsync(intruder, SyncApi.Checkin(id, Day, SyncApi.Past(1), sleepQuality: 5));
        var delete = await SyncApi.PushOneAsync(intruder, SyncApi.Delete(id, SyncApi.Past(1)));

        Assert.Equal(SyncResultStatus.Rejected, overwrite.Status);
        Assert.Equal(new[] { "forbidden" }, overwrite.Errors!);
        Assert.Equal(SyncResultStatus.Rejected, delete.Status);
        var row = Assert.Single(await SyncApi.RowsAsync(factory, id));
        Assert.Equal(2, row.SleepQuality);
        Assert.Null(row.DeletedAt);
        Assert.Empty((await SyncApi.PullAsync(intruder, 0)).Records);
    }

    [Fact]
    public async Task Push_requires_authentication()
    {
        using var client = factory.CreateClientWithOwnIp();

        var response = await SyncApi.PushRawAsync(client, new[] { SyncApi.Checkin(Guid.NewGuid(), Day, SyncApi.Past()) });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
