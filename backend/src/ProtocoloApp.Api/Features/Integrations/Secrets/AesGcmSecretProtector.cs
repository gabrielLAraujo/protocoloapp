using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;

namespace ProtocoloApp.Api.Features.Integrations.Secrets;

/// <summary>AES-256-GCM. Layout: <c>0x01 | nonce(12) | ciphertext | tag(16)</c>, AAD = purpose (UTF-8).</summary>
public sealed class AesGcmSecretProtector : ISecretProtector
{
    private const byte Version = 1;
    private const int KeySize = 32;
    private const int NonceSize = 12;
    private const int TagSize = 16;

    private readonly byte[]? _key;

    public AesGcmSecretProtector(IOptions<IntegrationsOptions> options, ILogger<AesGcmSecretProtector> logger)
    {
        _key = ParseKey(options.Value.EncryptionKey);
        if (_key is null)
        {
            logger.LogWarning("Integrations:EncryptionKey is missing or invalid (expected 32 bytes in base64); integrations are disabled.");
        }
    }

    public bool IsConfigured => _key is not null;

    public byte[] Protect(string plaintext, string purpose)
    {
        if (_key is null)
        {
            throw new InvalidOperationException("Secret protection is not configured.");
        }

        var data = Encoding.UTF8.GetBytes(plaintext);
        var result = new byte[1 + NonceSize + data.Length + TagSize];
        result[0] = Version;
        var nonce = result.AsSpan(1, NonceSize);
        RandomNumberGenerator.Fill(nonce);
        var cipher = result.AsSpan(1 + NonceSize, data.Length);
        var tag = result.AsSpan(1 + NonceSize + data.Length, TagSize);
        using var aes = new AesGcm(_key, TagSize);
        aes.Encrypt(nonce, data, cipher, tag, Encoding.UTF8.GetBytes(purpose));
        return result;
    }

    public bool TryUnprotect(byte[] data, string purpose, out string plaintext)
    {
        plaintext = "";
        if (_key is null || data.Length < 1 + NonceSize + TagSize || data[0] != Version)
        {
            return false;
        }

        var cipherLength = data.Length - 1 - NonceSize - TagSize;
        var buffer = new byte[cipherLength];
        try
        {
            using var aes = new AesGcm(_key, TagSize);
            aes.Decrypt(
                data.AsSpan(1, NonceSize),
                data.AsSpan(1 + NonceSize, cipherLength),
                data.AsSpan(1 + NonceSize + cipherLength, TagSize),
                buffer,
                Encoding.UTF8.GetBytes(purpose));
            plaintext = Encoding.UTF8.GetString(buffer);
            return true;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    private static byte[]? ParseKey(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var buffer = new byte[value.Length];
        return Convert.TryFromBase64String(value.Trim(), buffer, out var written) && written == KeySize
            ? buffer[..written]
            : null;
    }
}
