namespace ProtocoloApp.Api.Features.Auth;

public sealed class AuthOptions
{
    public const string Section = "Auth";
    public const int MinimumSigningKeyBytes = 32;

    /// <summary>HS256 key. Comes from the environment (<c>Auth__SigningKey</c>); at least 32 bytes, validated on startup.</summary>
    public string SigningKey { get; set; } = "";

    public string Issuer { get; set; } = "protocoloapp";

    public string Audience { get; set; } = "protocoloapp";
}
