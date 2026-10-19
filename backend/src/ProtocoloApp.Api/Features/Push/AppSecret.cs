namespace ProtocoloApp.Api.Features.Push;

/// <summary>A secret the server generates for itself (the VAPID key pair), kept in table <c>app_secrets</c> by name.</summary>
public sealed class AppSecret
{
    public const int MaxNameLength = 64;

    public string Name { get; set; } = "";

    public string Value { get; set; } = "";

    public DateTimeOffset CreatedAt { get; set; }
}
