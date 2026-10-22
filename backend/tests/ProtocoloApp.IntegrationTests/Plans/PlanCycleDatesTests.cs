using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Plans;

public sealed class PlanCycleDatesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static Task<HttpResponseMessage> PatchAsync(PlanApi api, Guid id, object body) =>
        api.Client.PatchAsJsonAsync(new Uri($"/api/plans/{id}/cycle-dates", UriKind.Relative), body, PlanApi.Json);

    private static async Task<PlanVersionResponse> ActiveProtocolAsync(PlanApi api, string? document = null)
    {
        var draft = await api.ImportDraftAsync(PlanKind.Protocol);
        if (document is not null)
            Assert.Equal(HttpStatusCode.OK, (await api.PutAsync(draft.Id, document)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id)).StatusCode);
        return await api.GetAsync(draft.Id);
    }

    [Fact]
    public async Task Owner_sets_the_dates_of_the_active_protocol_and_the_pull_shows_them()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var plan = await ActiveProtocolAsync(api, PlanSamples.Protocol.Replace("\"updateDate\":\"2026-11-01\",", "", StringComparison.Ordinal));
        var before = (await SyncApi.PullAllAsync(api.Client)).Single(r => r.Entity == "plan_version" && r.Id == plan.Id).Version;

        var response = await PatchAsync(api, plan.Id, new { updateDate = "2026-12-01", billingDate = "2026-12-05" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var pulled = (await SyncApi.PullAllAsync(api.Client)).Single(r => r.Entity == "plan_version" && r.Id == plan.Id);
        Assert.True(pulled.Version > before);
        var document = pulled.Payload!.Value.GetProperty("document");
        Assert.Equal("2026-12-01", document.GetProperty("updateDate").GetString());
        Assert.Equal("2026-12-05", document.GetProperty("billingDate").GetString());
        Assert.Equal("Fase 1", document.GetProperty("phaseName").GetString());
        Assert.Equal("active", pulled.Payload!.Value.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Null_clears_a_date_and_a_draft_can_be_edited_too()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync(PlanKind.Protocol);

        var response = await PatchAsync(api, draft.Id, new { updateDate = "2026-12-01", billingDate = (string?)null });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var read = await api.GetAsync(draft.Id);
        Assert.Equal("2026-12-01", read.Document.GetProperty("updateDate").GetString());
        Assert.True(read.Document.GetProperty("billingDate").ValueKind is JsonValueKind.Null);
        Assert.Equal(PlanStatus.Draft, read.Status);
    }

    [Fact]
    public async Task Another_user_gets_404_and_nothing_changes()
    {
        using var owner = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        var plan = await ActiveProtocolAsync(owner);

        var response = await PatchAsync(other, plan.Id, new { updateDate = "2026-12-01" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(plan.Document.GetRawText(), (await owner.GetAsync(plan.Id)).Document.GetRawText());
    }

    [Fact]
    public async Task A_workout_plan_is_rejected_with_400()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync(PlanKind.Workout);

        var response = await PatchAsync(api, draft.Id, new { updateDate = "2026-12-01" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("1999-12-31")]
    [InlineData("2200-01-01")]
    public async Task Dates_out_of_range_are_rejected(string date)
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync(PlanKind.Protocol);

        var response = await PatchAsync(api, draft.Id, new { updateDate = date });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("updateDate", out _));
    }

    [Fact]
    public async Task An_archived_version_is_409()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var first = await ActiveProtocolAsync(api);
        var second = await api.ImportDraftAsync(PlanKind.Protocol);
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(second.Id)).StatusCode);

        var response = await PatchAsync(api, first.Id, new { updateDate = "2026-12-01" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }
}
