namespace ProtocoloApp.Api.Features.Integrations.Secrets;

/// <summary>Server-side settings shared by third-party integrations.</summary>
public sealed class IntegrationsOptions
{
    public const string Section = "Integrations";

    /// <summary>32 bytes, base64. Missing or invalid: integrations stay disabled.</summary>
    public string? EncryptionKey { get; set; }
}
