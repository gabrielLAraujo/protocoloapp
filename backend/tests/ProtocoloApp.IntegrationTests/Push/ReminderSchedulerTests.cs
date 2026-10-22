using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.Api.Features.Push;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Sync;

namespace ProtocoloApp.IntegrationTests.Push;

[Collection("api")]
public sealed class ReminderSchedulerTests(ApiFactory factory)
{
    private const string SecretName = "Composto Secreto";
    private const string SecretDose = "999 mg";

    // 2026-03-10 in America/Sao_Paulo (UTC-3, no daylight saving): 15:30 UTC is 12:30 local.
    private static readonly DateOnly Day = new(2026, 3, 10);

    private static DateTimeOffset Local(string time) =>
        new(Day.ToDateTime(TimeOnly.Parse(time, CultureInfo.InvariantCulture)), TimeSpan.FromHours(-3));

    // No workout plan: the day is an off day, so the schedule rows below are "off".
    private const string Protocol = $$$"""
        {"phaseName":"Fase 1","updateDate":"2026-03-01",
         "meals":[
           {"key":"1","label":"REF 1","items":[{"food":"Arroz","grams":100,"alternatives":[]}]},
           {"key":"2","label":"REF 2","items":[{"food":"Frango","grams":150,"alternatives":[]}]}],
         "items":[
           {"key":"x1","category":"hormone","name":"{{{SecretName}}}","doseText":"{{{SecretDose}}}","timing":"fasting","schedule":{"type":"daily"}},
           {"key":"x2","category":"supplement","name":"Creatina","doseText":"5 g","timing":"with_meal:2","schedule":{"type":"daily"}},
           {"key":"x3","category":"supplement","name":"Magnésio","doseText":"400 mg","timing":"before_bed","schedule":{"type":"daily"}}],
         "cardio":{"daily":true,"durationMin":30},
         "guidelines":[]}
        """;

    private static SyncChange Slot(string slot, string time, bool reminder = true) =>
        new("schedule_slot", Guid.NewGuid(), SyncOp.Upsert,
            JsonSerializer.SerializeToElement(new Dictionary<string, object?> { ["slot"] = slot, ["day_type"] = "off", ["time"] = time, ["reminder_enabled"] = reminder }),
            SyncApi.Past(60));

    private static SyncChange Adherence(string type, string key, string status = "done") =>
        new("adherence_log", Guid.NewGuid(), SyncOp.Upsert,
            JsonSerializer.SerializeToElement(new Dictionary<string, object?>
            {
                ["date"] = Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ["target_type"] = type,
                ["target_key"] = key,
                ["status"] = status,
            }),
            SyncApi.Past(60));

    /// <summary>A user with an active protocol, the given slots and one push subscription.</summary>
    private async Task<(PlanApi Api, string Endpoint)> SetupAsync(params SyncChange[] changes)
    {
        var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync(PlanKind.Protocol);
        Assert.True((await api.PutAsync(draft.Id, Protocol)).IsSuccessStatusCode);
        Assert.True((await api.ActivateAsync(draft.Id)).IsSuccessStatusCode);
        if (changes.Length > 0)
            await SyncApi.PushAsync(api.Client, changes);
        return (api, await PushApi.AddSubscriptionAsync(api));
    }

    private async Task RunAsync(DateTimeOffset now)
    {
        await factory.Services.GetRequiredService<ReminderScheduler>().RunOnceAsync(now, CancellationToken.None);
    }

    [Fact]
    public async Task Meal_reminder_is_sent_once_at_its_minute()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;

        await RunAsync(Local("12:30"));
        await RunAsync(Local("12:30"));

        var message = Assert.Single(factory.Push.SentTo(endpoint));
        Assert.Equal("REF 2 — 12:30", message.Body);
        Assert.Equal("/hoje", message.Url);
        Assert.Equal("meal_2", message.Tag);
    }

    [Fact]
    public async Task A_later_tick_does_not_repeat_a_reminder_already_sent()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;

        await RunAsync(Local("12:30"));
        await RunAsync(Local("12:31"));
        await RunAsync(Local("12:32"));

        Assert.Single(factory.Push.SentTo(endpoint));
    }

    [Fact]
    public async Task Two_servers_at_the_same_minute_send_one_push()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;

        await Task.WhenAll(RunAsync(Local("12:30")), RunAsync(Local("12:30")), RunAsync(Local("12:30")));

        Assert.Single(factory.Push.SentTo(endpoint));
    }

    [Fact]
    public async Task A_tick_up_to_two_minutes_late_still_sends_but_three_does_not()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"), Slot("meal_1", "12:00"));
        using var _ = api;

        await RunAsync(Local("12:32"));
        await RunAsync(Local("12:03"));

        var message = Assert.Single(factory.Push.SentTo(endpoint));
        Assert.Equal("REF 2 — 12:30", message.Body);
    }

    [Fact]
    public async Task Nothing_is_sent_before_the_time()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;

        await RunAsync(Local("12:29"));

        Assert.Empty(factory.Push.SentTo(endpoint));
    }

    [Fact]
    public async Task Target_already_logged_on_the_server_is_not_reminded()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"), Adherence("meal", "2"), Adherence("protocol_item", "x2"));
        using var _ = api;

        await RunAsync(Local("12:30"));

        Assert.Empty(factory.Push.SentTo(endpoint));
    }

    [Fact]
    public async Task Slot_with_a_target_still_open_is_reminded_with_the_meal_label()
    {
        // The meal is logged but the item taken with it is not: the slot still has something to do.
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"), Adherence("meal", "2"));
        using var _ = api;

        await RunAsync(Local("12:30"));

        Assert.Equal("REF 2 — 12:30", Assert.Single(factory.Push.SentTo(endpoint)).Body);
    }

    /// <summary>A check-in part saved through sync (fictitious values); <c>parts</c> null = a full check-in as before the split.</summary>
    private static SyncChange CheckinPart(string[]? parts)
    {
        var payload = new Dictionary<string, object?> { ["date"] = Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) };
        if (parts is not null)
            payload["parts"] = parts;
        if (parts is null || parts.Contains("morning"))
        {
            payload["sleep_quality"] = 4;
            payload["energy_wake"] = 3;
            payload["bowel"] = "normal";
        }

        if (parts is null || parts.Contains("evening"))
        {
            payload["energy_day"] = 3;
            payload["anxiety"] = 2;
            payload["water_l"] = 2.5m;
        }

        return new SyncChange(SyncApi.Entity, Guid.NewGuid(), SyncOp.Upsert, JsonSerializer.SerializeToElement(payload), SyncApi.Past(60));
    }

    [Fact]
    public async Task Morning_part_saved_silences_the_morning_reminder_and_the_evening_one_still_goes()
    {
        var (api, endpoint) = await SetupAsync(Slot("checkin_morning", "07:00"), Slot("checkin", "21:30"), CheckinPart(["morning"]));
        using var _ = api;

        await RunAsync(Local("07:00"));
        Assert.Empty(factory.Push.SentTo(endpoint));

        await RunAsync(Local("21:30"));
        var message = Assert.Single(factory.Push.SentTo(endpoint));
        Assert.Equal("Check-in da noite", message.Body);
        Assert.Equal("checkin", message.Tag);
    }

    [Fact]
    public async Task Evening_part_saved_silences_the_evening_reminder_and_the_morning_one_still_goes()
    {
        var (api, endpoint) = await SetupAsync(Slot("checkin_morning", "07:00"), Slot("checkin", "21:30"), CheckinPart(["evening"]));
        using var _ = api;

        await RunAsync(Local("07:00"));
        await RunAsync(Local("21:30"));

        var message = Assert.Single(factory.Push.SentTo(endpoint));
        Assert.Equal("Check-in da manhã", message.Body);
        Assert.Equal("checkin_morning", message.Tag);
    }

    [Fact]
    public async Task Water_alone_in_the_evening_part_does_not_silence_the_evening_reminder()
    {
        var waterOnly = new SyncChange(SyncApi.Entity, Guid.NewGuid(), SyncOp.Upsert,
            JsonSerializer.SerializeToElement(new Dictionary<string, object?>
            {
                ["date"] = Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ["parts"] = new[] { "evening" },
                ["water_l"] = 1.5m,
            }),
            SyncApi.Past(60));
        var (api, endpoint) = await SetupAsync(Slot("checkin", "21:30"), waterOnly);
        using var _ = api;

        await RunAsync(Local("21:30"));

        Assert.Equal("Check-in da noite", Assert.Single(factory.Push.SentTo(endpoint)).Body);
    }

    [Fact]
    public async Task A_check_in_row_with_only_cardio_silences_neither_part()
    {
        var cardioOnly = new SyncChange(SyncApi.Entity, Guid.NewGuid(), SyncOp.Upsert,
            JsonSerializer.SerializeToElement(new Dictionary<string, object?>
            {
                ["date"] = Day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                ["parts"] = new[] { "cardio" },
                ["cardio_done"] = true,
            }),
            SyncApi.Past(60));
        var (api, endpoint) = await SetupAsync(Slot("checkin_morning", "07:00"), Slot("checkin", "21:30"), cardioOnly);
        using var _ = api;

        await RunAsync(Local("07:00"));
        await RunAsync(Local("21:30"));

        Assert.Equal(["Check-in da manhã", "Check-in da noite"], factory.Push.SentTo(endpoint).Select(m => m.Body));
    }

    [Fact]
    public async Task Legacy_checkin_log_silences_only_the_evening_reminder()
    {
        var (api, endpoint) = await SetupAsync(Slot("checkin_morning", "07:00"), Slot("checkin", "21:30"), Adherence("checkin", "checkin"));
        using var _ = api;

        await RunAsync(Local("07:00"));
        await RunAsync(Local("21:30"));

        Assert.Equal("Check-in da manhã", Assert.Single(factory.Push.SentTo(endpoint)).Body);
    }

    [Fact]
    public async Task A_full_check_in_saved_before_the_split_silences_both_reminders()
    {
        var (api, endpoint) = await SetupAsync(Slot("checkin_morning", "07:00"), Slot("checkin", "21:30"), CheckinPart(null));
        using var _ = api;

        await RunAsync(Local("07:00"));
        await RunAsync(Local("21:30"));

        Assert.Empty(factory.Push.SentTo(endpoint));
    }

    [Fact]
    public async Task Check_in_part_logs_silence_their_reminders()
    {
        var (api, endpoint) = await SetupAsync(
            Slot("checkin_morning", "07:00"), Slot("checkin", "21:30"), Adherence("checkin", "checkin_morning"), Adherence("checkin", "checkin_evening"));
        using var _ = api;

        await RunAsync(Local("07:00"));
        await RunAsync(Local("21:30"));

        Assert.Empty(factory.Push.SentTo(endpoint));
    }

    [Fact]
    public async Task Missed_target_counts_as_logged_too()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"), Adherence("meal", "2", "missed"), Adherence("protocol_item", "x2", "missed"));
        using var _ = api;

        await RunAsync(Local("12:30"));

        Assert.Empty(factory.Push.SentTo(endpoint));
    }

    [Fact]
    public async Task Disabled_reminder_is_not_sent()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30", reminder: false));
        using var _ = api;

        await RunAsync(Local("12:30"));

        Assert.Empty(factory.Push.SentTo(endpoint));
    }

    [Fact]
    public async Task Gone_subscription_is_removed_without_failing()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;
        factory.Push.Results[endpoint] = PushResult.Gone;

        await RunAsync(Local("12:30"));

        Assert.Single(factory.Push.SentTo(endpoint));
        Assert.Empty(await PushApi.SubscriptionsAsync(factory, endpoint));
    }

    [Fact]
    public async Task Failed_send_counts_a_failure_and_the_fifth_removes_the_subscription()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;
        factory.Push.Results[endpoint] = PushResult.Failed;

        await RunAsync(Local("12:30"));
        Assert.Equal(1, Assert.Single(await PushApi.SubscriptionsAsync(factory, endpoint)).FailureCount);

        var (other, nearlyDead) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _2 = other;
        await other.WithDbAsync(async db =>
        {
            await db.PushSubscriptions.Where(s => s.Endpoint == nearlyDead).ExecuteUpdateAsync(s => s.SetProperty(x => x.FailureCount, 4));
            return 0;
        });
        factory.Push.Results[nearlyDead] = PushResult.Failed;

        await RunAsync(Local("12:30"));

        Assert.Empty(await PushApi.SubscriptionsAsync(factory, nearlyDead));
    }

    [Fact]
    public async Task Transient_failures_neither_count_nor_remove_and_retries_stop_at_the_end_of_the_window()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;
        await api.WithDbAsync(async db =>
        {
            await db.PushSubscriptions.Where(s => s.Endpoint == endpoint).ExecuteUpdateAsync(s => s.SetProperty(x => x.FailureCount, 4));
            return 0;
        });
        factory.Push.Results[endpoint] = PushResult.Transient;

        foreach (var time in new[] { "12:30", "12:31", "12:32", "12:33", "12:34" })
            await RunAsync(Local(time));

        // One try per minute of the tolerance window (12:30, 12:31, 12:32), none after it.
        Assert.Equal(3, factory.Push.SentTo(endpoint).Count);
        Assert.Equal(4, Assert.Single(await PushApi.SubscriptionsAsync(factory, endpoint)).FailureCount);
        Assert.Equal(0, await ClaimsAsync(api));
    }

    [Fact]
    public async Task A_transient_send_releases_the_slot_and_the_next_minute_sends_exactly_once()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;
        factory.Push.Results[endpoint] = PushResult.Transient;

        await RunAsync(Local("12:30"));
        Assert.Equal(0, await ClaimsAsync(api));

        factory.Push.Results[endpoint] = PushResult.Sent;
        await RunAsync(Local("12:31"));
        await RunAsync(Local("12:31"));
        await RunAsync(Local("12:32"));

        // The failed try at 12:30 and the delivered one at 12:31; nothing after.
        Assert.Equal(2, factory.Push.SentTo(endpoint).Count);
        Assert.Equal(1, await ClaimsAsync(api));
        Assert.Equal(0, Assert.Single(await PushApi.SubscriptionsAsync(factory, endpoint)).FailureCount);
    }

    [Fact]
    public async Task A_slot_delivered_to_one_device_is_kept_even_if_another_device_is_transient()
    {
        var (api, flaky) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;
        var good = await PushApi.AddSubscriptionAsync(api);
        factory.Push.Results[flaky] = PushResult.Transient;

        await RunAsync(Local("12:30"));
        await RunAsync(Local("12:31"));

        Assert.Single(factory.Push.SentTo(good));
        Assert.Single(factory.Push.SentTo(flaky));
        Assert.Equal(1, await ClaimsAsync(api));
    }

    [Fact]
    public async Task A_slot_where_every_device_fails_permanently_is_claimed_once_and_counts_one_failure()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;
        factory.Push.Results[endpoint] = PushResult.Failed;

        await RunAsync(Local("12:30"));
        await RunAsync(Local("12:31"));
        await RunAsync(Local("12:32"));

        Assert.Single(factory.Push.SentTo(endpoint));
        Assert.Equal(1, Assert.Single(await PushApi.SubscriptionsAsync(factory, endpoint)).FailureCount);
        Assert.Equal(1, await ClaimsAsync(api));
    }

    private static Task<int> ClaimsAsync(PlanApi api) =>
        api.WithDbAsync(db => db.ReminderSends.CountAsync(r => r.UserId == api.UserId && r.Date == Day && r.Slot == "meal_2"));

    [Fact]
    public async Task Push_copy_uses_generic_labels_and_never_the_dose_or_the_item_name()
    {
        var (api, endpoint) = await SetupAsync(
            Slot("fasting", "06:30"), Slot("checkin_morning", "07:00"), Slot("before_bed", "22:30"), Slot("cardio", "07:30"), Slot("checkin", "21:30"));
        using var _ = api;

        foreach (var time in new[] { "06:30", "07:00", "07:30", "21:30", "22:30" })
            await RunAsync(Local(time));

        var messages = factory.Push.SentTo(endpoint);
        Assert.Equal(
            ["Itens em jejum", "Check-in da manhã", "Hora do cardio", "Check-in da noite", "Itens antes de dormir"],
            messages.Select(m => m.Body));
        Assert.All(messages, m =>
        {
            var everything = $"{m.Title} {m.Body} {m.Url} {m.Tag}";
            Assert.DoesNotContain(SecretName, everything, StringComparison.Ordinal);
            Assert.DoesNotContain(SecretDose, everything, StringComparison.Ordinal);
        });
    }

    [Fact]
    public async Task Meal_and_its_items_share_one_push_and_other_slots_get_their_own()
    {
        // Meal 2 and the item taken "with_meal:2" are both in slot meal_2; the fasting item is another slot at the same minute.
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"), Slot("fasting", "12:30"));
        using var _ = api;

        await RunAsync(Local("12:30"));

        Assert.Equal(["Itens em jejum", "REF 2 — 12:30"], factory.Push.SentTo(endpoint).Select(m => m.Body).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Users_without_subscription_and_other_users_are_left_alone()
    {
        var (api, endpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;
        var (stranger, strangerEndpoint) = await SetupAsync();
        using var _2 = stranger;

        await RunAsync(Local("12:30"));

        Assert.Single(factory.Push.SentTo(endpoint));
        Assert.Empty(factory.Push.SentTo(strangerEndpoint));
    }

    [Fact]
    public async Task A_database_error_for_one_user_does_not_stop_the_next_one_in_the_same_tick()
    {
        var (broken, brokenEndpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = broken;
        var (healthy, healthyEndpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _2 = healthy;
        // Claiming the reminder of this user's slot fails in the database (a check constraint only they violate).
        await broken.WithDbAsync(async db =>
        {
            var connection = db.Database.GetDbConnection();
            await connection.OpenAsync();
            try
            {
                await using var command = connection.CreateCommand();
                command.CommandText = $"ALTER TABLE reminder_sends ADD CONSTRAINT ck_test_{Guid.NewGuid():N} CHECK (user_id <> '{broken.UserId}'::uuid)";
                await command.ExecuteNonQueryAsync();
            }
            finally
            {
                await connection.CloseAsync();
            }

            return 0;
        });

        await RunAsync(Local("12:30"));

        Assert.Empty(factory.Push.SentTo(brokenEndpoint));
        Assert.Equal("REF 2 — 12:30", Assert.Single(factory.Push.SentTo(healthyEndpoint)).Body);
    }

    [Fact]
    public async Task A_sender_that_throws_for_one_device_does_not_stop_the_other_device_or_the_user_after()
    {
        var (api, bad) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _ = api;
        var good = await PushApi.AddSubscriptionAsync(api);
        factory.Push.Throws[bad] = true;
        var (other, otherEndpoint) = await SetupAsync(Slot("meal_2", "12:30"));
        using var _2 = other;

        await RunAsync(Local("12:30"));

        Assert.Single(factory.Push.SentTo(good));
        Assert.Single(factory.Push.SentTo(otherEndpoint));
        Assert.Equal(1, Assert.Single(await PushApi.SubscriptionsAsync(factory, bad)).FailureCount);
    }
}
