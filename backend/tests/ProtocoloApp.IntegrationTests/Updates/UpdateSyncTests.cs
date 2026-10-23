using System.Globalization;
using System.Net;
using System.Text.Json;
using ProtocoloApp.Api.Features.Files;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Updates;

/// <summary>Helpers shared by the update tests: fictitious templates and cycle changes (no real questions or photos).</summary>
internal static class UpdateApi
{
    public const string Template = "questionnaire_template";
    public const string Cycle = "update_cycle";

    public const string TemplateDocument = """
        {"title":"Questionário de exemplo",
         "sections":[
           {"title":"Seção de exemplo","questions":[
             {"key":"week_summary","text":"Como foi sua semana de exemplo?","kind":"long_text"},
             {"key":"diet_error","text":"Erro na dieta de exemplo?","kind":"text","fill":"diet_error_pct"},
             {"key":"example_choice","text":"Escolha uma opção de exemplo.","kind":"choice","options":["A","B"]}]}],
         "poses":[{"key":"front","label":"Frente"},{"key":"back","label":"Costas"}]}
        """;

    public static SyncChange TemplateChange(Guid id, DateTimeOffset at, string document = TemplateDocument)
    {
        using var parsed = JsonDocument.Parse(document);
        var payload = JsonSerializer.SerializeToElement(new Dictionary<string, object?> { ["document"] = parsed.RootElement.Clone() });
        return new SyncChange(Template, id, SyncOp.Upsert, payload, at);
    }

    public static SyncChange CycleChange(
        Guid id,
        DateTimeOffset at,
        string status = "draft",
        IReadOnlyDictionary<string, string>? answers = null,
        IReadOnlyList<(string Pose, Guid FileId)>? photos = null,
        string periodEnd = "2030-01-01",
        Guid? protocolVersionId = null) =>
        new(Cycle, id, SyncOp.Upsert, JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["protocol_version_id"] = protocolVersionId ?? Guid.NewGuid(),
            ["period_start"] = "2029-12-01",
            ["period_end"] = periodEnd,
            ["status"] = status,
            ["answers"] = answers ?? new Dictionary<string, string> { ["week_summary"] = "Semana de exemplo." },
            ["photos"] = (photos ?? []).Select(p => new Dictionary<string, object?>
            {
                ["pose"] = p.Pose,
                ["file_id"] = p.FileId,
                ["taken_at"] = "2026-03-10T12:00:00Z",
            }).ToList(),
            ["sent_at"] = null,
        }), at);

    /// <summary>Imports and activates a protocol (the sample has <c>updateDate</c> 2026-11-01 unless replaced).</summary>
    public static async Task<Guid> ActivateProtocolAsync(PlanApi api, string? document = null)
    {
        var draft = await api.ImportDraftAsync(PlanKind.Protocol);
        if (document is not null)
            Assert.Equal(HttpStatusCode.OK, (await api.PutAsync(draft.Id, document)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id)).StatusCode);
        return draft.Id;
    }

    public static async Task<List<SyncRecord>> CyclesAsync(HttpClient client) =>
        (await SyncApi.PullAllAsync(client)).Where(r => r.Entity == Cycle).ToList();

    public static async Task<SyncRecord> SingleCycleAsync(HttpClient client) => Assert.Single(await CyclesAsync(client));

    public static Task<HttpResponseMessage> EnsureAsync(HttpClient client) =>
        client.PostAsync(new Uri("/api/update-cycles/ensure", UriKind.Relative), null);

    public static string Date(JsonElement payload, string field) => payload.GetProperty(field).GetString()!;

    public static string LocalToday() =>
        DateOnly.FromDateTime(DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(-3)).DateTime).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static void AssertRejected(SyncChangeResult result, string error)
    {
        Assert.Equal(SyncResultStatus.Rejected, result.Status);
        Assert.Equal(new[] { error }, result.Errors);
    }
}

public sealed class UpdateSyncTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task A_template_roundtrips_as_sent()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var id = Guid.NewGuid();

        var result = await SyncApi.PushOneAsync(api.Client, UpdateApi.TemplateChange(id, SyncApi.Past()));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var record = Assert.Single((await SyncApi.PullAllAsync(api.Client)).Where(r => r.Entity == UpdateApi.Template));
        Assert.Equal(id, record.Id);
        var document = record.Payload!.Value.GetProperty("document");
        Assert.Equal("Questionário de exemplo", document.GetProperty("title").GetString());
        var questions = document.GetProperty("sections")[0].GetProperty("questions");
        Assert.Equal("diet_error_pct", questions[1].GetProperty("fill").GetString());
        Assert.Equal(2, questions[2].GetProperty("options").GetArrayLength());
        Assert.Equal("back", document.GetProperty("poses")[1].GetProperty("key").GetString());
    }

    [Fact]
    public async Task An_edit_replaces_the_template()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var id = Guid.NewGuid();
        await SyncApi.PushOneAsync(api.Client, UpdateApi.TemplateChange(id, SyncApi.Past(60)));

        var edit = await SyncApi.PushOneAsync(
            api.Client,
            UpdateApi.TemplateChange(id, SyncApi.Past(30), UpdateApi.TemplateDocument.Replace("Questionário de exemplo", "Outro título", StringComparison.Ordinal)));

        Assert.Equal(SyncResultStatus.Applied, edit.Status);
        var record = Assert.Single((await SyncApi.PullAllAsync(api.Client)).Where(r => r.Entity == UpdateApi.Template));
        Assert.Equal("Outro título", record.Payload!.Value.GetProperty("document").GetProperty("title").GetString());
    }

    [Fact]
    public async Task A_second_live_template_is_a_conflict_until_the_first_is_deleted()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        await SyncApi.PushOneAsync(api.Client, UpdateApi.TemplateChange(first, SyncApi.Past(60)));

        var conflict = await SyncApi.PushOneAsync(api.Client, UpdateApi.TemplateChange(second, SyncApi.Past(50)));
        await SyncApi.PushOneAsync(api.Client, new SyncChange(UpdateApi.Template, first, SyncOp.Delete, null, SyncApi.Past(40)));
        var replaced = await SyncApi.PushOneAsync(api.Client, UpdateApi.TemplateChange(second, SyncApi.Past(30)));

        UpdateApi.AssertRejected(conflict, SyncErrors.TemplateConflict);
        Assert.Equal(SyncResultStatus.Applied, replaced.Status);
    }

    [Fact]
    public async Task An_invalid_template_is_rejected_with_the_path()
    {
        using var api = await PlanApi.CreateAsync(factory);

        var result = await SyncApi.PushOneAsync(
            api.Client,
            UpdateApi.TemplateChange(Guid.NewGuid(), SyncApi.Past(), UpdateApi.TemplateDocument.Replace("diet_error_pct", "foo", StringComparison.Ordinal)));

        UpdateApi.AssertRejected(result, SyncErrors.InvalidPayloadField("document.sections[0].questions[1].fill"));
        Assert.DoesNotContain(await SyncApi.PullAllAsync(api.Client), r => r.Entity == UpdateApi.Template);
    }

    [Fact]
    public async Task A_cycle_with_an_unknown_id_is_read_only()
    {
        using var api = await PlanApi.CreateAsync(factory);

        var result = await SyncApi.PushOneAsync(api.Client, UpdateApi.CycleChange(Guid.NewGuid(), SyncApi.Past()));

        UpdateApi.AssertRejected(result, SyncErrors.ReadOnly);
        Assert.Empty(await UpdateApi.CyclesAsync(api.Client));
    }

    [Fact]
    public async Task A_push_changes_answers_status_and_photos_and_ignores_the_server_fields()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var protocolId = await UpdateApi.ActivateProtocolAsync(api);
        var cycle = await UpdateApi.SingleCycleAsync(api.Client);
        var photo = await api.CreateFileAsync(FileKind.Photo);

        var result = await SyncApi.PushOneAsync(
            api.Client,
            UpdateApi.CycleChange(
                cycle.Id,
                DateTimeOffset.UtcNow,
                status: "sent",
                answers: new Dictionary<string, string> { ["week_summary"] = "Semana de exemplo.", ["diet_error"] = "10%" },
                photos: [("front", photo)],
                periodEnd: "2030-01-01",
                protocolVersionId: Guid.NewGuid()));

        Assert.Equal(SyncResultStatus.Applied, result.Status);
        var pulled = (await UpdateApi.SingleCycleAsync(api.Client)).Payload!.Value;
        Assert.Equal("sent", pulled.GetProperty("status").GetString());
        Assert.Equal("10%", pulled.GetProperty("answers").GetProperty("diet_error").GetString());
        Assert.Equal("Semana de exemplo.", pulled.GetProperty("answers").GetProperty("week_summary").GetString());
        var photos = pulled.GetProperty("photos");
        Assert.Equal(1, photos.GetArrayLength());
        Assert.Equal("front", photos[0].GetProperty("pose").GetString());
        Assert.Equal(photo, photos[0].GetProperty("file_id").GetGuid());
        Assert.NotEqual(JsonValueKind.Null, pulled.GetProperty("sent_at").ValueKind);
        Assert.Equal("2026-11-01", UpdateApi.Date(pulled, "period_end"));
        Assert.Equal(protocolId, pulled.GetProperty("protocol_version_id").GetGuid());
    }

    [Fact]
    public async Task A_replay_older_than_the_cycle_is_stale()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await UpdateApi.ActivateProtocolAsync(api);
        var cycle = await UpdateApi.SingleCycleAsync(api.Client);

        var result = await SyncApi.PushOneAsync(api.Client, UpdateApi.CycleChange(cycle.Id, SyncApi.Past(60)));

        Assert.Equal(SyncResultStatus.Stale, result.Status);
    }

    [Fact]
    public async Task A_cycle_cannot_be_deleted()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await UpdateApi.ActivateProtocolAsync(api);
        var cycle = await UpdateApi.SingleCycleAsync(api.Client);

        var result = await SyncApi.PushOneAsync(api.Client, new SyncChange(UpdateApi.Cycle, cycle.Id, SyncOp.Delete, null, DateTimeOffset.UtcNow));

        UpdateApi.AssertRejected(result, SyncErrors.ReadOnly);
        Assert.Null((await UpdateApi.SingleCycleAsync(api.Client)).DeletedAt);
    }

    [Fact]
    public async Task A_photo_must_be_a_confirmed_photo_file_of_the_user()
    {
        using var api = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        await UpdateApi.ActivateProtocolAsync(api);
        var cycle = await UpdateApi.SingleCycleAsync(api.Client);
        var othersPhoto = await other.CreateFileAsync(FileKind.Photo);
        var pending = await api.CreateFileAsync(FileKind.Photo, confirmed: false);
        var pdf = await api.CreateFileAsync(FileKind.ProtocolPdf);

        foreach (var file in new[] { othersPhoto, pending, pdf, Guid.NewGuid() })
        {
            var result = await SyncApi.PushOneAsync(api.Client, UpdateApi.CycleChange(cycle.Id, DateTimeOffset.UtcNow, photos: [("front", file)]));
            UpdateApi.AssertRejected(result, SyncErrors.InvalidReference);
        }

        var pulled = (await UpdateApi.SingleCycleAsync(api.Client)).Payload!.Value;
        Assert.Equal("collecting", pulled.GetProperty("status").GetString());
        Assert.Equal(0, pulled.GetProperty("photos").GetArrayLength());
    }

    [Fact]
    public async Task An_invalid_cycle_payload_is_rejected_per_field()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await UpdateApi.ActivateProtocolAsync(api);
        var cycle = await UpdateApi.SingleCycleAsync(api.Client);

        var status = await SyncApi.PushOneAsync(api.Client, UpdateApi.CycleChange(cycle.Id, DateTimeOffset.UtcNow, status: "done"));
        var answers = await SyncApi.PushOneAsync(
            api.Client,
            UpdateApi.CycleChange(cycle.Id, DateTimeOffset.UtcNow, answers: new Dictionary<string, string> { ["A b"] = "Texto." }));

        UpdateApi.AssertRejected(status, SyncErrors.InvalidPayloadField("status"));
        UpdateApi.AssertRejected(answers, SyncErrors.InvalidPayloadField("answers"));
    }

    [Fact]
    public async Task Another_user_sees_nothing_and_cannot_write()
    {
        using var owner = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        await UpdateApi.ActivateProtocolAsync(owner);
        await SyncApi.PushOneAsync(owner.Client, UpdateApi.TemplateChange(Guid.NewGuid(), SyncApi.Past()));
        var cycle = await UpdateApi.SingleCycleAsync(owner.Client);

        var write = await SyncApi.PushOneAsync(other.Client, UpdateApi.CycleChange(cycle.Id, DateTimeOffset.UtcNow));
        var ensure = await UpdateApi.EnsureAsync(other.Client);

        UpdateApi.AssertRejected(write, SyncErrors.Forbidden);
        Assert.Equal(HttpStatusCode.NoContent, ensure.StatusCode);
        Assert.DoesNotContain(await SyncApi.PullAllAsync(other.Client), r => r.Entity is UpdateApi.Template or UpdateApi.Cycle);
        Assert.Equal("collecting", (await UpdateApi.SingleCycleAsync(owner.Client)).Payload!.Value.GetProperty("status").GetString());
    }
}
