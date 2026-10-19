using System.Buffers.Binary;
using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;

namespace ProtocoloApp.Api.Features.Push;

/// <summary>
/// Message encryption for Web Push, RFC 8291 with the <c>aes128gcm</c> content coding of RFC 8188 (single record), written
/// with the platform's crypto only. Apple's push service accepts nothing else.
/// </summary>
public static class WebPushCrypto
{
    public const int RecordSize = 4096;

    /// <summary>
    /// Push services cap the whole body at 4096 bytes: the 86-byte header (salt, rs, idlen, key)
    /// plus one record holding the data, a 0x02 delimiter and the 16-byte GCM tag.
    /// </summary>
    public const int MaxPlaintextLength = RecordSize - 86 - 17;

    public const int PublicKeyLength = 65;
    public const int AuthSecretLength = 16;

    private const int SaltLength = 16;

    /// <summary>Body of the push request: header (salt, record size, sender key) followed by the encrypted record.</summary>
    /// <param name="userPublicKey">The subscription's <c>p256dh</c> (uncompressed P-256 point, 65 bytes).</param>
    /// <param name="authSecret">The subscription's <c>auth</c> (16 bytes).</param>
    public static byte[] Encrypt(ReadOnlySpan<byte> plaintext, byte[] userPublicKey, byte[] authSecret)
    {
        using var server = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        return Encrypt(plaintext, userPublicKey, authSecret, server, RandomNumberGenerator.GetBytes(SaltLength));
    }

    /// <summary>Same with the sender's ephemeral key and the salt given (the RFC test vector fixes both).</summary>
    internal static byte[] Encrypt(ReadOnlySpan<byte> plaintext, byte[] userPublicKey, byte[] authSecret, ECDiffieHellman server, byte[] salt)
    {
        ArgumentNullException.ThrowIfNull(userPublicKey);
        ArgumentNullException.ThrowIfNull(authSecret);
        ArgumentNullException.ThrowIfNull(server);
        ArgumentNullException.ThrowIfNull(salt);

        if (plaintext.Length > MaxPlaintextLength)
            throw new ArgumentException("The message does not fit in one record.", nameof(plaintext));
        if (userPublicKey.Length != PublicKeyLength || userPublicKey[0] != 0x04)
            throw new ArgumentException("The subscription key is not an uncompressed P-256 point.", nameof(userPublicKey));
        if (authSecret.Length != AuthSecretLength)
            throw new ArgumentException("The auth secret must be 16 bytes.", nameof(authSecret));

        var serverPoint = server.ExportParameters(false).Q;
        var serverPublicKey = new byte[PublicKeyLength];
        serverPublicKey[0] = 0x04;
        serverPoint.X!.CopyTo(serverPublicKey, 1);
        serverPoint.Y!.CopyTo(serverPublicKey, 33);

        using var user = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = userPublicKey[1..33], Y = userPublicKey[33..65] },
        });
        var shared = server.DeriveRawSecretAgreement(user.PublicKey);

        // RFC 8291 section 3.4: mix the auth secret and both public keys into the input keying material.
        var prkKey = HKDF.Extract(HashAlgorithmName.SHA256, shared, authSecret);
        var keyInfo = Concat(Encoding.ASCII.GetBytes("WebPush: info\0"), userPublicKey, serverPublicKey);
        var ikm = HKDF.Expand(HashAlgorithmName.SHA256, prkKey, 32, keyInfo);

        // RFC 8188 section 2.2/2.3.
        var prk = HKDF.Extract(HashAlgorithmName.SHA256, ikm, salt);
        var cek = HKDF.Expand(HashAlgorithmName.SHA256, prk, 16, Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"));
        var nonce = HKDF.Expand(HashAlgorithmName.SHA256, prk, 12, Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"));

        var padded = new byte[plaintext.Length + 1];
        plaintext.CopyTo(padded);
        padded[^1] = 0x02; // last record

        var record = new byte[padded.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(cek, tag.Length))
            aes.Encrypt(nonce, padded, record, tag);

        var header = new byte[SaltLength + 4 + 1 + PublicKeyLength];
        salt.CopyTo(header, 0);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(SaltLength, 4), RecordSize);
        header[SaltLength + 4] = PublicKeyLength;
        serverPublicKey.CopyTo(header, SaltLength + 5);
        return Concat(header, record, tag);
    }

    /// <summary>Strict unpadded base64url, as browsers send keys. Null when it is not valid.</summary>
    public static byte[]? TryDecode(string? text)
    {
        if (string.IsNullOrEmpty(text) || text.Length > 256)
            return null;

        try
        {
            return Base64Url.DecodeFromChars(text);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    internal static byte[] Concat(params byte[][] parts)
    {
        var result = new byte[parts.Sum(p => p.Length)];
        var offset = 0;
        foreach (var part in parts)
        {
            part.CopyTo(result, offset);
            offset += part.Length;
        }

        return result;
    }
}
