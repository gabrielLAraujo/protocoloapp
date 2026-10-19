using System.Buffers.Text;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ProtocoloApp.Api.Features.Push;

/// <summary>The server's VAPID identity (RFC 8292): the contact <c>Subject</c> and the P-256 key pair, base64url.</summary>
public sealed record VapidDetails(string Subject, string PublicKey, string PrivateKey);

public static class Vapid
{
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromHours(12);

    public static (string PublicKey, string PrivateKey) GenerateKeys()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var parameters = key.ExportParameters(true);
        return (Base64Url.EncodeToString(PublicKeyBytes(parameters.Q)), Base64Url.EncodeToString(parameters.D!));
    }

    /// <summary>The <c>Authorization</c> header value: <c>vapid t=&lt;ES256 JWT&gt;, k=&lt;public key&gt;</c>, audience = the push service's origin.</summary>
    public static string AuthorizationHeader(Uri endpoint, VapidDetails details, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        ArgumentNullException.ThrowIfNull(details);

        var header = Base64Url.EncodeToString(Encoding.UTF8.GetBytes("""{"typ":"JWT","alg":"ES256"}"""));
        var claims = Base64Url.EncodeToString(JsonSerializer.SerializeToUtf8Bytes(new
        {
            aud = $"{endpoint.Scheme}://{endpoint.Authority}",
            exp = (now + TokenLifetime).ToUnixTimeSeconds(),
            sub = details.Subject,
        }));
        var input = $"{header}.{claims}";

        var publicKey = Base64Url.DecodeFromChars(details.PublicKey);
        using var key = ECDsa.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            D = Base64Url.DecodeFromChars(details.PrivateKey),
            Q = new ECPoint { X = publicKey[1..33], Y = publicKey[33..65] },
        });
        var signature = key.SignData(Encoding.ASCII.GetBytes(input), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return string.Create(CultureInfo.InvariantCulture, $"vapid t={input}.{Base64Url.EncodeToString(signature)}, k={details.PublicKey}");
    }

    private static byte[] PublicKeyBytes(ECPoint point)
    {
        var bytes = new byte[WebPushCrypto.PublicKeyLength];
        bytes[0] = 0x04;
        point.X!.CopyTo(bytes, 1);
        point.Y!.CopyTo(bytes, 33);
        return bytes;
    }
}
