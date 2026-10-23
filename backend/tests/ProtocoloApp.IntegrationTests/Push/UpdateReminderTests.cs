using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Features.Updates;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Push;

public sealed class UpdateReminderTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    // 2026-03-10 in America/Sao_Paulo (UTC-3): the update date D is this day plus the days left.
    private static readonly DateOnly Day = new(2026, 3, 10);

    private static DateTimeOffset Local(string time, int addDays = 0) =>
        new(Day.AddDays(addDays).ToDateTime(TimeOnly.Parse(time, CultureInfo.InvariantCulture)), TimeSpan.FromHours(-3));

    private const string Protocol = """
        {"phaseName":"Fase 1","updateDate":"2026-03-01",
         "meals":[{"key":"1","label":"REF 1","items":[{"food":"Arroz","grams":100,"alternatives":[]}]}],
         "items":[],"cardio":{"daily":false},"guidelines":[]}
        """;

    private static SyncChange MorningSlot(string time, bool reminderEnabled = true) =>
        new("schedule_slot", Guid.NewGuid(), SyncOp.Upsert,
            JsonSerializer.SerializeToElement(new Dictionary<string, object?> { ["slot"] = "checkin_morning", ["day_type"] = "off", ["time"] = time, ["reminder_enabled"] = reminderEnabled }),
            SyncApi.Past(60));

    /// <summary>A user with an active protocol, a cycle ending on <paramref name="periodEnd"/>, and one push subscription.</summary>
    private async Task<(PlanApi Api, string Endpoint)> SetupAsync(DateOnly periodEnd, UpdateCycleStatus status = UpdateCycleStatus.Collecting, params SyncChange[] changes)
    {
        var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync(PlanKind.Protocol);
        Assert.True((await api.PutAsync(draft.Id, Protocol)).IsSuccessStatusCode);
        Assert.True((await api.ActivateAsync(draft.Id)).IsSuccessStatusCode);
        if (changes.Length > 0)
            await SyncApi.PushAsync(api.Client, changes);
        await api.WithDbAsync(async db =>
        {
            var cycle = await db.UpdateCycles.SingleAsync(c => c.UserId == api.UserId);
            cycle.PeriodEnd = periodEnd;
            cycle.Status = status;
            await db.SaveChangesAsync();
            return 0;
        });
        return (api, await PushApi.AddSubscriptionAsync(api));
    }

    // The morning slot's own reminder (check-in) may go at the same minute: only the photos reminder counts here.
    private List<PushMessage> UpdatePushes(string endpoint) =>
        factory.Push.SentTo(endpoint).Where(m => m.Tag == ReminderScheduler.UpdatePhotosSlot).ToList();

    private Task RunAsync(DateTimeOffset now) =>
        factory.Services.GetRequiredService<ReminderScheduler>().RunOnceAsync(now, CancellationToken.None);

    [Fact]
    public async Task Four_days_before_nothing_is_sent()
    {
        var (api, endpoint) = await SetupAsync(Day.AddDays(4), UpdateCycleStatus.Collecting, MorningSlot("07:00"));
        using var _ = api;

        await RunAsync(Local("07:00"));

        Assert.Empty(UpdatePushes(endpoint));
    }

    [Fact]
    public async Task Three_days_before_it_is_sent_once_at_the_morning_checkin_time()
    {
        var (api, endpoint) = await SetupAsync(Day.AddDays(3), UpdateCycleStatus.Collecting, MorningSlot("07:00"));
        using var _ = api;

        await RunAsync(Local("06:59"));
        Assert.Empty(UpdatePushes(endpoint));

        await RunAsync(Local("07:00"));
        await RunAsync(Local("07:00"));
        await RunAsync(Local("07:01"));

        var message = Assert.Single(UpdatePushes(endpoint));
        Assert.Equal("Protocolo", message.Title);
        Assert.Equal("Atualização em 3 dias: hora das fotos", message.Body);
        Assert.Equal("/atualizacao", message.Url);
        Assert.Equal("update_photos", message.Tag);
    }

    [Theory]
    [InlineData(1, "Atualização amanhã: hora das fotos")]
    [InlineData(0, "Atualização hoje: hora das fotos")]
    public async Task The_last_days_use_the_short_texts(int daysLeft, string body)
    {
        var (api, endpoint) = await SetupAsync(Day.AddDays(daysLeft), UpdateCycleStatus.Draft, MorningSlot("07:00"));
        using var _ = api;

        await RunAsync(Local("07:00"));

        Assert.Equal(body, Assert.Single(UpdatePushes(endpoint)).Body);
    }

    [Fact]
    public async Task A_sent_cycle_does_not_send()
    {
        var (api, endpoint) = await SetupAsync(Day.AddDays(1), UpdateCycleStatus.Sent, MorningSlot("07:00"));
        using var _ = api;

        await RunAsync(Local("07:00"));

        Assert.Empty(UpdatePushes(endpoint));
    }

    [Fact]
    public async Task After_the_update_date_nothing_is_sent()
    {
        var (api, endpoint) = await SetupAsync(Day.AddDays(-1), UpdateCycleStatus.Collecting, MorningSlot("07:00"));
        using var _ = api;

        await RunAsync(Local("07:00"));

        Assert.Empty(UpdatePushes(endpoint));
    }

    [Fact]
    public async Task Without_a_morning_slot_it_goes_at_nine()
    {
        var (api, endpoint) = await SetupAsync(Day.AddDays(2));
        using var _ = api;

        await RunAsync(Local("08:59"));
        Assert.Empty(UpdatePushes(endpoint));

        await RunAsync(Local("09:00"));
        Assert.Equal("Atualização em 2 dias: hora das fotos", Assert.Single(UpdatePushes(endpoint)).Body);
    }

    [Fact]
    public async Task The_text_carries_no_protocol_content()
    {
        var (api, endpoint) = await SetupAsync(Day.AddDays(1));
        using var _ = api;

        await RunAsync(Local("09:00"));

        var message = Assert.Single(UpdatePushes(endpoint));
        Assert.DoesNotContain("REF 1", message.Body, StringComparison.Ordinal);
        Assert.DoesNotContain("Fase 1", message.Body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task With_the_morning_checkin_reminder_off_nothing_is_sent()
    {
        var (api, endpoint) = await SetupAsync(Day.AddDays(2), UpdateCycleStatus.Collecting, MorningSlot("07:00", reminderEnabled: false));
        using var _ = api;

        await RunAsync(Local("07:00"));
        await RunAsync(Local("09:00"));

        Assert.Empty(UpdatePushes(endpoint));
    }

    [Fact]
    public async Task An_active_protocol_without_a_cycle_gets_one_and_its_reminder()
    {
        // Activated before the update cycles existed: the protocol is active, its cycle was never made.
        var api = await PlanApi.CreateAsync(factory);
        using var _ = api;
        var draft = await api.ImportDraftAsync(PlanKind.Protocol);
        Assert.True((await api.PutAsync(draft.Id, Protocol.Replace("2026-03-01", "2026-03-12", StringComparison.Ordinal))).IsSuccessStatusCode);
        Assert.True((await api.ActivateAsync(draft.Id)).IsSuccessStatusCode);
        await api.WithDbAsync(db => db.UpdateCycles.Where(c => c.UserId == api.UserId).ExecuteDeleteAsync());
        var endpoint = await PushApi.AddSubscriptionAsync(api);

        await RunAsync(Local("09:00"));

        var cycle = await api.WithDbAsync(db => db.UpdateCycles.AsNoTracking().SingleAsync(c => c.UserId == api.UserId));
        Assert.Equal(draft.Id, cycle.ProtocolVersionId);
        Assert.Equal(new DateOnly(2026, 3, 12), cycle.PeriodEnd);
        Assert.Equal("Atualização em 2 dias: hora das fotos", Assert.Single(UpdatePushes(endpoint)).Body);

        // Idempotent: the next tick makes no second cycle.
        await RunAsync(Local("09:01"));
        Assert.Equal(1, await api.WithDbAsync(db => db.UpdateCycles.CountAsync(c => c.UserId == api.UserId)));
    }
}
