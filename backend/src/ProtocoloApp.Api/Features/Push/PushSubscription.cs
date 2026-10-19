namespace ProtocoloApp.Api.Features.Push;

/// <summary>A browser/app push subscription of a user (Web Push). The endpoint is unique: a device belongs to one user.</summary>
public sealed class PushSubscription
{
    public const int MaxEndpointLength = 2048;
    public const int MaxKeyLength = 256;
    public const int MaxUserAgentLength = 300;

    /// <summary>Consecutive failed sends after which the subscription is dropped.</summary>
    public const int MaxFailures = 5;

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public string Endpoint { get; set; } = "";

    public string P256dh { get; set; } = "";

    public string Auth { get; set; } = "";

    public string? UserAgent { get; set; }

    public int FailureCount { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
