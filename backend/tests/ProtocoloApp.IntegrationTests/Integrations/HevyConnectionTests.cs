using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Features.Auth;
using ProtocoloApp.Api.Features.Integrations.Hevy;
using ProtocoloApp.Api.Features.Integrations.Secrets;
using ProtocoloApp.Api.Features.Plans;
using ProtocoloApp.IntegrationTests.Auth;
using ProtocoloApp.IntegrationTests.Infra;
using ProtocoloApp.IntegrationTests.Plans;
using ProtocoloApp.IntegrationTests.Updates;

namespace ProtocoloApp.IntegrationTests.Integrations;

/// <summary>Connecting, changing and removing the Hevy key. Keys are fictitious; the fake client answers for Hevy.</summary>
public sealed class HevyConnectionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly Uri Url = new("/api/integrations/hevy", UriKind.Relative);

    private static int _keyCounter;

    private static int _ipCounter;

    /// <summary>A fictitious key, distinct per call so the fake's per-key answers do not leak between tests.</summary>
    private static string NewKey() => $"test-key-0000-0000-0000-{Interlocked.Increment(ref _keyCounter):D12}";

    private static Task<HttpResponseMessage> ConnectAsync(HttpClient client, string? apiKey, DateOnly? syncFrom = null) =>
        client.PutAsJsonAsync(Url, new { apiKey, syncFrom }, PlanApi.Json);

    private static Task<HttpResponseMessage> PatchAsync(HttpClient client, DateOnly? syncFrom) =>
        client.PatchAsJsonAsync(Url, new { syncFrom }, PlanApi.Json);

    private static async Task<HevyStatusResponse> StatusAsync(HttpClient client)
    {
        var response = await client.GetAsync(Url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<HevyStatusResponse>(PlanApi.Json))!;
    }

    private static DateOnly Today() => DateOnly.ParseExact(UpdateApi.LocalToday(), "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    private static Task<HevyConnection?> RowAsync(PlanApi api) =>
        api.WithDbAsync(db => db.HevyConnections.AsNoTracking().SingleOrDefaultAsync(c => c.UserId == api.UserId));

    [Fact]
    public async Task Get_without_a_connection_proposes_today_minus_30()
    {
        using var api = await PlanApi.CreateAsync(factory);

        var status = await StatusAsync(api.Client);

        Assert.True(status.ServerConfigured);
        Assert.False(status.Connected);
        Assert.Null(status.KeyLast4);
        Assert.Equal(Today().AddDays(-30), status.SyncFrom);
        Assert.Null(status.LastError);
        Assert.False(status.Running);
        Assert.Equal(0, status.PendingExercises);
    }

    [Fact]
    public async Task Put_with_a_valid_key_connects_and_never_returns_the_key()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var key = NewKey();

        var response = await ConnectAsync(api.Client, $"  {key}  ");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var raw = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(key, raw, StringComparison.Ordinal);
        var status = JsonSerializer.Deserialize<HevyStatusResponse>(raw, PlanApi.Json)!;
        Assert.True(status.Connected);
        Assert.Equal(key[^4..], status.KeyLast4);
        Assert.Contains(key, factory.Hevy.CheckedKeys);

        var row = (await RowAsync(api))!;
        Assert.Equal(key[^4..], row.KeyLast4);
        Assert.Null(row.Cursor);
        Assert.False(Contains(row.ApiKeyCipher, Encoding.UTF8.GetBytes(key)));
        Assert.DoesNotContain(key, await (await api.Client.GetAsync(Url)).Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Put_with_a_key_hevy_refuses_is_422_in_portuguese()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var key = NewKey();
        factory.Hevy.KeyErrors[key] = HevyError.Unauthorized;

        var response = await ConnectAsync(api.Client, key);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var raw = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(key, raw, StringComparison.Ordinal);
        using var problem = JsonDocument.Parse(raw);
        Assert.Equal(HevyConnectionEndpoints.RejectedKeyMessage, problem.RootElement.GetProperty("errors").GetProperty("apiKey")[0].GetString());
        Assert.Null(await RowAsync(api));
    }

    [Theory]
    [InlineData(HevyError.Unavailable)]
    [InlineData(HevyError.RateLimited)]
    public async Task Put_when_hevy_cannot_be_reached_is_502(HevyError error)
    {
        using var api = await PlanApi.CreateAsync(factory);
        var key = NewKey();
        factory.Hevy.KeyErrors[key] = error;

        var response = await ConnectAsync(api.Client, key);

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(HevyConnectionEndpoints.UnavailableMessage, problem.RootElement.GetProperty("detail").GetString());
        Assert.Null(await RowAsync(api));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task Put_without_a_key_is_400(string? key)
    {
        using var api = await PlanApi.CreateAsync(factory);

        var response = await ConnectAsync(api.Client, key);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(problem.RootElement.GetProperty("errors").TryGetProperty("apiKey", out _));
    }

    [Fact]
    public async Task Put_with_a_key_too_long_is_400()
    {
        using var api = await PlanApi.CreateAsync(factory);

        var response = await ConnectAsync(api.Client, new string('k', HevyConnectionEndpoints.MaxApiKeyLength + 1));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("k")]
    [InlineData("abcdefg")]
    public async Task Put_with_a_key_too_short_to_hide_is_400(string key)
    {
        using var api = await PlanApi.CreateAsync(factory);

        var response = await ConnectAsync(api.Client, key);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(HevyConnectionEndpoints.ApiKeyLengthMessage, problem.RootElement.GetProperty("errors").GetProperty("apiKey")[0].GetString());
        Assert.Null(await RowAsync(api));
    }

    [Fact]
    public async Task The_shortest_key_taken_shows_its_last_4()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var key = NewKey()[^HevyConnectionEndpoints.MinApiKeyLength..];

        Assert.Equal(HttpStatusCode.OK, (await ConnectAsync(api.Client, key)).StatusCode);

        var status = (await (await api.Client.GetAsync(Url)).Content.ReadFromJsonAsync<HevyStatusResponse>(PlanApi.Json))!;
        Assert.Equal(key[^4..], status.KeyLast4);
    }

    [Fact]
    public async Task Put_with_a_future_sync_from_is_400()
    {
        using var api = await PlanApi.CreateAsync(factory);

        var response = await ConnectAsync(api.Client, NewKey(), Today().AddDays(2));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Sync_from_defaults_to_the_start_of_the_open_update_cycle()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var draft = await api.ImportDraftAsync(PlanKind.Protocol);
        Assert.Equal(HttpStatusCode.OK, (await api.ActivateAsync(draft.Id, new DateOnly(2026, 10, 1))).StatusCode);

        Assert.Equal(new DateOnly(2026, 10, 1), (await StatusAsync(api.Client)).SyncFrom);
        Assert.Equal(HttpStatusCode.OK, (await ConnectAsync(api.Client, NewKey())).StatusCode);

        Assert.Equal(new DateOnly(2026, 10, 1), (await RowAsync(api))!.SyncFrom);
    }

    [Fact]
    public async Task Sync_from_without_a_cycle_is_today_minus_30_and_an_explicit_one_wins()
    {
        using var api = await PlanApi.CreateAsync(factory);

        Assert.Equal(HttpStatusCode.OK, (await ConnectAsync(api.Client, NewKey())).StatusCode);
        Assert.Equal(Today().AddDays(-30), (await RowAsync(api))!.SyncFrom);

        Assert.Equal(HttpStatusCode.OK, (await ConnectAsync(api.Client, NewKey(), new DateOnly(2026, 9, 15))).StatusCode);
        Assert.Equal(new DateOnly(2026, 9, 15), (await StatusAsync(api.Client)).SyncFrom);
    }

    [Fact]
    public async Task Replacing_the_key_keeps_one_row_and_resets_the_cursor()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await ConnectAsync(api.Client, NewKey());
        await SetCursorAsync(api);
        var second = NewKey();

        Assert.Equal(HttpStatusCode.OK, (await ConnectAsync(api.Client, second)).StatusCode);

        var row = (await RowAsync(api))!;
        Assert.Equal(second[^4..], row.KeyLast4);
        Assert.Null(row.Cursor);
        Assert.Null(row.LastError);
        Assert.Equal(1, await api.WithDbAsync(db => db.HevyConnections.CountAsync(c => c.UserId == api.UserId)));
    }

    [Fact]
    public async Task Patch_changes_the_date_and_resets_the_cursor()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await ConnectAsync(api.Client, NewKey());
        await SetCursorAsync(api);

        var response = await PatchAsync(api.Client, new DateOnly(2026, 8, 1));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new DateOnly(2026, 8, 1), (await response.Content.ReadFromJsonAsync<HevyStatusResponse>(PlanApi.Json))!.SyncFrom);
        var row = (await RowAsync(api))!;
        Assert.Equal(new DateOnly(2026, 8, 1), row.SyncFrom);
        Assert.Null(row.Cursor);
    }

    [Fact]
    public async Task Patch_without_a_connection_is_404_and_without_a_date_is_400()
    {
        using var api = await PlanApi.CreateAsync(factory);

        Assert.Equal(HttpStatusCode.NotFound, (await PatchAsync(api.Client, new DateOnly(2026, 8, 1))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PatchAsync(api.Client, null)).StatusCode);
    }

    [Fact]
    public async Task Delete_removes_the_connection()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await ConnectAsync(api.Client, NewKey());

        Assert.Equal(HttpStatusCode.NoContent, (await api.Client.DeleteAsync(Url)).StatusCode);

        Assert.False((await StatusAsync(api.Client)).Connected);
        Assert.Null(await RowAsync(api));
        Assert.Equal(HttpStatusCode.NoContent, (await api.Client.DeleteAsync(Url)).StatusCode);
    }

    [Fact]
    public async Task Another_user_does_not_see_the_connection()
    {
        using var owner = await PlanApi.CreateAsync(factory);
        using var other = await PlanApi.CreateAsync(factory);
        await ConnectAsync(owner.Client, NewKey());

        Assert.False((await StatusAsync(other.Client)).Connected);
        Assert.Equal(HttpStatusCode.NotFound, (await PatchAsync(other.Client, new DateOnly(2026, 8, 1))).StatusCode);
        await other.Client.DeleteAsync(Url);
        Assert.True((await StatusAsync(owner.Client)).Connected);
    }

    [Fact]
    public async Task A_key_saved_with_another_encryption_key_is_key_unreadable()
    {
        using var api = await PlanApi.CreateAsync(factory);
        var otherKey = Convert.ToBase64String(Enumerable.Range(100, 32).Select(i => (byte)i).ToArray());
        var otherProtector = new AesGcmSecretProtector(
            Options.Create(new IntegrationsOptions { EncryptionKey = otherKey }),
            NullLogger<AesGcmSecretProtector>.Instance);
        await api.WithDbAsync(async db =>
        {
            db.HevyConnections.Add(new HevyConnection
            {
                UserId = api.UserId,
                ApiKeyCipher = otherProtector.Protect(NewKey(), HevyConnections.Purpose(api.UserId)),
                KeyLast4 = "0001",
                SyncFrom = new DateOnly(2026, 9, 1),
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            return await db.SaveChangesAsync();
        });

        var response = await api.Client.GetAsync(Url);

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("key_unreadable", json.RootElement.GetProperty("lastError").GetString());
        Assert.True(json.RootElement.GetProperty("connected").GetBoolean());

        // "Sincronizar agora" says so in the app's words.
        var sync = await api.Client.PostAsync(new Uri("/api/integrations/hevy/sync", UriKind.Relative), null);
        Assert.Equal(HttpStatusCode.BadGateway, sync.StatusCode);
        using var problem = JsonDocument.Parse(await sync.Content.ReadAsStringAsync());
        Assert.Equal("key_unreadable", problem.RootElement.GetProperty("lastError").GetString());
        Assert.Equal("A chave salva não pode mais ser lida. Informe a chave do Hevy de novo.", problem.RootElement.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Stored_error_and_result_are_returned()
    {
        using var api = await PlanApi.CreateAsync(factory);
        await ConnectAsync(api.Client, NewKey());
        await api.WithDbAsync(async db =>
        {
            var row = await db.HevyConnections.SingleAsync(c => c.UserId == api.UserId);
            row.LastError = "rate_limited";
            row.LastResult = HevyConnections.WriteResult(new HevySyncResult(3, 1, 0, 2, 0, 1, 0));
            return await db.SaveChangesAsync();
        });

        using var json = JsonDocument.Parse(await (await api.Client.GetAsync(Url)).Content.ReadAsStringAsync());

        Assert.Equal("rate_limited", json.RootElement.GetProperty("lastError").GetString());
        var result = json.RootElement.GetProperty("lastResult");
        Assert.Equal(3, result.GetProperty("imported").GetInt32());
        Assert.Equal(1, result.GetProperty("skippedSets").GetInt32());
    }

    [Fact]
    public async Task Without_an_encryption_key_the_server_is_not_configured_and_health_stays_up()
    {
        await using var unconfigured = factory.WithWebHostBuilder(b => b.UseSetting("Integrations:EncryptionKey", ""));
        using var client = await LoginAsync(unconfigured);

        var status = (await client.GetFromJsonAsync<HevyStatusResponse>(Url, PlanApi.Json))!;
        var put = await ConnectAsync(client, NewKey());
        using var anonymous = unconfigured.CreateClient();
        var health = await anonymous.GetAsync(new Uri("/health", UriKind.Relative));

        Assert.False(status.ServerConfigured);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, put.StatusCode);
        using var problem = JsonDocument.Parse(await put.Content.ReadAsStringAsync());
        Assert.Equal(HevyConnectionEndpoints.NotConfiguredMessage, problem.RootElement.GetProperty("detail").GetString());
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
    }

    [Fact]
    public async Task A_short_invalid_encryption_key_is_not_configured_either()
    {
        await using var invalid = factory.WithWebHostBuilder(b => b.UseSetting("Integrations:EncryptionKey", "c2hvcnQta2V5"));
        using var client = await LoginAsync(invalid);

        Assert.False((await client.GetFromJsonAsync<HevyStatusResponse>(Url, PlanApi.Json))!.ServerConfigured);
    }

    private async Task<HttpClient> LoginAsync(WebApplicationFactory<Program> host)
    {
        var email = AuthApi.NewEmail();
        await factory.CreateUserAsync(email);
        var client = host.CreateClient();
        var n = Interlocked.Increment(ref _ipCounter);
        client.DefaultRequestHeaders.Add("X-Forwarded-For", $"10.250.{(n >> 8) & 255}.{n & 255}");
        var response = await client.PostAsJsonAsync(new Uri("/api/auth/login", UriKind.Relative), new LoginRequest(email, ApiFactory.DefaultPassword));
        response.EnsureSuccessStatusCode();
        var tokens = await response.Content.ReadFromJsonAsync<TokenResponse>();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tokens!.AccessToken);
        return client;
    }

    private static Task SetCursorAsync(PlanApi api) =>
        api.WithDbAsync(db => db.HevyConnections.Where(c => c.UserId == api.UserId).ExecuteUpdateAsync(s => s
            .SetProperty(c => c.Cursor, (DateTimeOffset?)DateTimeOffset.UtcNow)
            .SetProperty(c => c.LastError, "unavailable")));

    private static bool Contains(byte[] haystack, byte[] needle) =>
        haystack.AsSpan().IndexOf(needle) >= 0;
}
