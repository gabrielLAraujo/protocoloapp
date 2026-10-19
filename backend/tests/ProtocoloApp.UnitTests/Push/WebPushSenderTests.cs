using System.Buffers.Text;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using ProtocoloApp.Api.Features.Push;

namespace ProtocoloApp.UnitTests.Push;

public sealed class WebPushSenderTests
{
    private const string Endpoint = "https://fcm.googleapis.com/fcm/send/abc";

    private sealed class StubVapid(VapidDetails details) : IVapidProvider
    {
        public Task<VapidDetails> GetAsync(CancellationToken ct) => Task.FromResult(details);
    }

    private sealed class CapturingHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }

        public byte[] Body { get; private set; } = [];

        public int Calls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            Request = request;
            Body = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
            return respond(request);
        }
    }

    private readonly ECDiffieHellman _user = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    private readonly byte[] _auth = RandomNumberGenerator.GetBytes(16);
    private readonly VapidDetails _vapid;
    private readonly FakeTimeProvider _clock = new(new DateTimeOffset(2026, 3, 10, 15, 30, 0, TimeSpan.Zero));

    public WebPushSenderTests()
    {
        var (publicKey, privateKey) = Vapid.GenerateKeys();
        _vapid = new VapidDetails("mailto:admin@example.test", publicKey, privateKey);
    }

    private PushSubscription Subscription(string? p256dh = null, string? auth = null)
    {
        var point = _user.ExportParameters(false).Q;
        var key = new byte[] { 0x04 }.Concat(point.X!).Concat(point.Y!).ToArray();
        return new PushSubscription
        {
            Id = Guid.NewGuid(),
            Endpoint = Endpoint,
            P256dh = p256dh ?? Base64Url.EncodeToString(key),
            Auth = auth ?? Base64Url.EncodeToString(_auth),
        };
    }

    private WebPushSender Sender(CapturingHandler handler) =>
        new(new HttpClient(handler), new StubVapid(_vapid), _clock, NullLogger<WebPushSender>.Instance);

    private static CapturingHandler Responding(HttpStatusCode status) => new(_ => new HttpResponseMessage(status));

    private static readonly PushMessage Message = new("Protocolo", "REF 2 — 12:30", "/hoje", "meal_2");

    [Fact]
    public async Task Request_is_aes128gcm_with_ttl_and_vapid_authorization_and_carries_the_message()
    {
        var handler = Responding(HttpStatusCode.Created);

        var result = await Sender(handler).SendAsync(Subscription(), Message, CancellationToken.None);

        Assert.Equal(PushResult.Sent, result);
        var request = handler.Request!;
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(Endpoint, request.RequestUri!.ToString());
        Assert.Equal(["aes128gcm"], request.Content!.Headers.ContentEncoding);
        Assert.Equal("application/octet-stream", request.Content.Headers.ContentType!.MediaType);
        Assert.Equal(WebPushSender.TtlSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture), Assert.Single(request.Headers.GetValues("TTL")));
        var authorization = Assert.Single(request.Headers.GetValues("Authorization"));
        Assert.Matches(@"^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=" + _vapid.PublicKey + "$", authorization);

        var payload = JsonDocument.Parse(WebPushCryptoTests.Decrypt(handler.Body, _user, _auth)).RootElement;
        Assert.Equal("Protocolo", payload.GetProperty("title").GetString());
        Assert.Equal("REF 2 — 12:30", payload.GetProperty("body").GetString());
        Assert.Equal("/hoje", payload.GetProperty("url").GetString());
        Assert.Equal("meal_2", payload.GetProperty("tag").GetString());
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Gone)]
    public async Task Missing_subscription_is_gone(HttpStatusCode status) =>
        Assert.Equal(PushResult.Gone, await Sender(Responding(status)).SendAsync(Subscription(), Message, CancellationToken.None));

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge)]
    public async Task Other_client_errors_are_permanent_failures(HttpStatusCode status) =>
        Assert.Equal(PushResult.Failed, await Sender(Responding(status)).SendAsync(Subscription(), Message, CancellationToken.None));

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.BadGateway)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.GatewayTimeout)]
    public async Task Rate_limit_and_server_errors_are_transient(HttpStatusCode status) =>
        Assert.Equal(PushResult.Transient, await Sender(Responding(status)).SendAsync(Subscription(), Message, CancellationToken.None));

    [Fact]
    public async Task Network_errors_are_transient()
    {
        var handler = new CapturingHandler(_ => throw new HttpRequestException("down"));

        Assert.Equal(PushResult.Transient, await Sender(handler).SendAsync(Subscription(), Message, CancellationToken.None));
    }

    [Fact]
    public async Task An_http_client_timeout_is_transient()
    {
        // HttpClient reports its own timeout as a TaskCanceledException while the caller's token is not cancelled.
        var handler = new CapturingHandler(_ => throw new TaskCanceledException("timeout", new TimeoutException()));

        Assert.Equal(PushResult.Transient, await Sender(handler).SendAsync(Subscription(), Message, CancellationToken.None));
    }

    [Theory]
    [InlineData("BKey-fictitious", null)]
    [InlineData(null, "short")]
    [InlineData("not base64 !!", null)]
    public async Task Malformed_stored_keys_are_a_failure_not_an_exception_and_nothing_is_sent(string? p256dh, string? auth)
    {
        var handler = Responding(HttpStatusCode.Created);

        var result = await Sender(handler).SendAsync(Subscription(p256dh, auth), Message, CancellationToken.None);

        Assert.Equal(PushResult.Failed, result);
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public async Task A_point_that_is_not_on_the_curve_is_a_failure()
    {
        var offCurve = new byte[65];
        offCurve[0] = 0x04;
        offCurve[1] = 1;
        offCurve[33] = 1;

        var result = await Sender(Responding(HttpStatusCode.Created)).SendAsync(Subscription(Base64Url.EncodeToString(offCurve)), Message, CancellationToken.None);

        Assert.Equal(PushResult.Failed, result);
    }

    [Fact]
    public async Task Cancellation_is_not_swallowed()
    {
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();
        var handler = new CapturingHandler(_ => new HttpResponseMessage(HttpStatusCode.Created));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Sender(handler).SendAsync(Subscription(), Message, cts.Token));
    }
}
