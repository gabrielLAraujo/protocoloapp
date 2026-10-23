using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Features.Updates;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Updates;

/// <summary>The server side of the cycle: created at the protocol's activation, moved by its update date.</summary>
public sealed class UpdateCycleLifecycleTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly string WithoutUpdateDate = PlanSamples.Protocol.Replace("\"updateDate\":\"2026-11-01\",", "", StringComparison.Ordinal);

    private static Task<HttpResponseMessage> PatchDatesAsync(PlanApi api, Guid id, string? updateDate) =>
        api.Client.PatchAsJsonAsync(new Uri($"/api/plans/{id}/cycle-dates", UriKind.Relative), new { updateDate, billingDate = (string?)null }, PlanApi.Json);

    [Fact]
    public async Task Activating_a_protocol_with_an_update_date_opens_one_cycle()
    {
        using var api = await PlanApi.CreateAsync(factory);

        var protocolId = await UpdateApi.ActivateProtocolAsync(api);
        var again = await api.ActivateAsync(protocolId);

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var cycle = await UpdateApi.SingleCycleAsync(api.Client);
        var payload = cycle.Payload!.Value;
        Assert.Equal(protocolId, payload.GetProperty("protocol_version_id").GetGuid());
        Assert.Equal("collecting", payload.GetProperty("status").GetString());
        Assert.Equal(UpdateApi.LocalToday(), UpdateApi.Date(payload, "period_start"));
        Assert.Equal("2026-11-01", UpdateApi.Date(payload, "period_end"));
        Assert.Empty(payload.GetProperty("answers").EnumerateObject());
        Assert.Equal(0, payload.GetProperty("photos").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, payload.GetProperty("sent_at").ValueKind);
    }

    [Fact]
    public async Task The_cycle_starts_on_the_chosen_cycle_start()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync(PlanKind.Protocol);

        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id, new DateOnly(2026, 10, 1))).StatusCode);

        Assert.Equal("2026-10-01", UpdateApi.Date((await UpdateApi.SingleCycleAsync(api.Client)).Payload!.Value, "period_start"));
    }

    [Fact]
    public async Task Ensure_returns_the_cycle_and_never_duplicates_it()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await UpdateApi.ActivateProtocolAsync(api);
        var cycle = await UpdateApi.SingleCycleAsync(api.Client);

        var first = await UpdateApi.EnsureAsync(api.Client);
        var second = await UpdateApi.EnsureAsync(api.Client);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(cycle.Id, (await first.Content.ReadFromJsonAsync<EnsureUpdateCycleResponse>(PlanApi.Json))!.Id);
        Assert.Equal(cycle.Id, (await second.Content.ReadFromJsonAsync<EnsureUpdateCycleResponse>(PlanApi.Json))!.Id);
        Assert.Single(await UpdateApi.CyclesAsync(api.Client));
    }

    [Fact]
    public async Task Without_an_active_protocol_or_an_update_date_there_is_no_cycle()
    {
        using var api = await PlanApi.CreateAsync(factory);

        Assert.Equal(HttpStatusCode.NoContent, (await UpdateApi.EnsureAsync(api.Client)).StatusCode);
        await UpdateApi.ActivateProtocolAsync(api, WithoutUpdateDate);

        Assert.Equal(HttpStatusCode.NoContent, (await UpdateApi.EnsureAsync(api.Client)).StatusCode);
        Assert.Empty(await UpdateApi.CyclesAsync(api.Client));
    }

    [Fact]
    public async Task Setting_the_update_date_of_an_active_protocol_opens_its_cycle()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var protocolId = await UpdateApi.ActivateProtocolAsync(api, WithoutUpdateDate);

        Assert.Equal(HttpStatusCode.OK, (await PatchDatesAsync(api, protocolId, "2026-12-15")).StatusCode);

        Assert.Equal("2026-12-15", UpdateApi.Date((await UpdateApi.SingleCycleAsync(api.Client)).Payload!.Value, "period_end"));
    }

    [Fact]
    public async Task A_new_protocol_version_opens_a_new_cycle()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var first = await UpdateApi.ActivateProtocolAsync(api);
        var second = await UpdateApi.ActivateProtocolAsync(api);

        var cycles = await UpdateApi.CyclesAsync(api.Client);

        Assert.Equal(2, cycles.Count);
        Assert.Equal(
            new[] { first, second }.Order().ToList(),
            cycles.Select(c => c.Payload!.Value.GetProperty("protocol_version_id").GetGuid()).Order().ToList());
    }

    [Fact]
    public async Task New_dates_move_the_cycle_end_and_an_earlier_edit_from_the_device_still_applies()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var protocolId = await UpdateApi.ActivateProtocolAsync(api);
        var created = await UpdateApi.SingleCycleAsync(api.Client);
        await Task.Delay(20);
        // Edited on the device (offline) before the dates change on the server.
        var editedAt = DateTimeOffset.UtcNow;
        await Task.Delay(20);

        Assert.Equal(HttpStatusCode.OK, (await PatchDatesAsync(api, protocolId, "2026-12-15")).StatusCode);
        var moved = await UpdateApi.SingleCycleAsync(api.Client);
        var result = await SyncApi.PushOneAsync(
            api.Client,
            UpdateApi.CycleChange(created.Id, editedAt, answers: new Dictionary<string, string> { ["week_summary"] = "Escrito offline." }));

        Assert.True(moved.Version > created.Version);
        Assert.Equal("2026-12-15", UpdateApi.Date(moved.Payload!.Value, "period_end"));
        Assert.Equal(created.ClientUpdatedAt, moved.ClientUpdatedAt);
        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var pulled = (await UpdateApi.SingleCycleAsync(api.Client)).Payload!.Value;
        Assert.Equal("Escrito offline.", pulled.GetProperty("answers").GetProperty("week_summary").GetString());
        Assert.Equal("2026-12-15", UpdateApi.Date(pulled, "period_end"));
    }

    [Fact]
    public async Task A_null_update_date_keeps_the_cycle_end()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var protocolId = await UpdateApi.ActivateProtocolAsync(api);

        Assert.Equal(HttpStatusCode.OK, (await PatchDatesAsync(api, protocolId, null)).StatusCode);

        Assert.Equal("2026-11-01", UpdateApi.Date((await UpdateApi.SingleCycleAsync(api.Client)).Payload!.Value, "period_end"));
    }

    [Fact]
    public async Task A_sent_cycle_keeps_its_dates()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var protocolId = await UpdateApi.ActivateProtocolAsync(api);
        var cycle = await UpdateApi.SingleCycleAsync(api.Client);
        var sent = await SyncApi.PushOneAsync(api.Client, UpdateApi.CycleChange(cycle.Id, DateTimeOffset.UtcNow, status: "sent"));

        Assert.Equal(HttpStatusCode.OK, (await PatchDatesAsync(api, protocolId, "2026-12-15")).StatusCode);

        Assert.Equal(SyncResultStatus.Applied, sent.Status);
        var pulled = (await UpdateApi.SingleCycleAsync(api.Client)).Payload!.Value;
        Assert.Equal("sent", pulled.GetProperty("status").GetString());
        Assert.Equal("2026-11-01", UpdateApi.Date(pulled, "period_end"));
    }
}
