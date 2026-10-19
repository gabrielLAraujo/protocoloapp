using System.Collections.Concurrent;
using ProtocoloApp.Api.Features.Push;

namespace ProtocoloApp.IntegrationTests.Infra;

/// <summary>An <see cref="IPushSender"/> that sends nothing: it records every message and answers per endpoint (default <see cref="PushResult.Sent"/>).</summary>
public sealed class FakePushSender : IPushSender
{
    private readonly ConcurrentQueue<(string Endpoint, PushMessage Message)> _sent = new();

    /// <summary>What to answer for an endpoint; endpoints not listed get <see cref="PushResult.Sent"/>.</summary>
    public ConcurrentDictionary<string, PushResult> Results { get; } = new();

    /// <summary>Endpoints whose send throws (after being recorded), like a sender with a bug would.</summary>
    public ConcurrentDictionary<string, bool> Throws { get; } = new();

    public Task<PushResult> SendAsync(PushSubscription subscription, PushMessage message, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(subscription);

        _sent.Enqueue((subscription.Endpoint, message));
        if (Throws.ContainsKey(subscription.Endpoint))
            throw new InvalidOperationException("Fake sender failure.");

        return Task.FromResult(Results.GetValueOrDefault(subscription.Endpoint, PushResult.Sent));
    }

    public IReadOnlyList<PushMessage> SentTo(string endpoint) => _sent.Where(s => s.Endpoint == endpoint).Select(s => s.Message).ToList();
}
