namespace ProtocoloApp.Api.Features.Integrations.Secrets;

/// <summary>Encrypts small secrets (third-party API keys) before they are stored.</summary>
public interface ISecretProtector
{
    /// <summary>False when the server has no usable encryption key.</summary>
    bool IsConfigured { get; }

    /// <summary>Encrypts <paramref name="plaintext"/>; <paramref name="purpose"/> is bound as AAD (e.g. <c>hevy:{userId}</c>).</summary>
    /// <exception cref="InvalidOperationException">Not configured.</exception>
    byte[] Protect(string plaintext, string purpose);

    /// <summary>False when not configured, the data is malformed, tampered, or the purpose differs.</summary>
    bool TryUnprotect(byte[] data, string purpose, out string plaintext);
}
