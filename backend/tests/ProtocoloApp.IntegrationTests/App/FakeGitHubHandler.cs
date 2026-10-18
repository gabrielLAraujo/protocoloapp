using System.Collections.Concurrent;
using System.Net;
using System.Text;

namespace ProtocoloApp.IntegrationTests.App;

/// <summary>What the API sent to "GitHub", copied before the request is disposed.</summary>
public sealed record RecordedRequest(HttpMethod Method, Uri Uri, string? Authorization, string? Accept);

/// <summary>Stands in for GitHub: the responder decides the answer for each request, every request is recorded.</summary>
public sealed class FakeGitHubHandler(Func<RecordedRequest, HttpResponseMessage> responder) : HttpMessageHandler
{
    private readonly ConcurrentQueue<RecordedRequest> _requests = new();

    public IReadOnlyCollection<RecordedRequest> Requests => _requests;

    /// <summary>How long GitHub takes to answer (to make concurrent requests overlap).</summary>
    public TimeSpan Delay { get; init; }

    public static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var recorded = new RecordedRequest(
            request.Method,
            request.RequestUri!,
            request.Headers.Authorization?.ToString(),
            request.Headers.Accept.ToString());
        _requests.Enqueue(recorded);
        if (Delay > TimeSpan.Zero)
            await Task.Delay(Delay, cancellationToken);
        return responder(recorded);
    }
}
