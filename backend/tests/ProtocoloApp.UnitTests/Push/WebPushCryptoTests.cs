using System.Buffers.Binary;
using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ProtocoloApp.Api.Features.Push;

namespace ProtocoloApp.UnitTests.Push;

public sealed class WebPushCryptoTests
{
    // Keys are generated per run: no key material lives in the repository.
    private static readonly ECDiffieHellman User = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    private static readonly byte[] UserPublicKey = PublicPoint(User);
    private static readonly byte[] AuthSecretBytes = RandomNumberGenerator.GetBytes(16);

    private static byte[] B(string base64Url) => Base64Url.DecodeFromChars(base64Url);

    private static byte[] PublicPoint(ECDiffieHellman key)
    {
        var q = key.ExportParameters(false).Q;
        return [0x04, .. q.X!, .. q.Y!];
    }

    [Fact]
    public void Body_follows_the_rfc_8188_layout_with_one_record()
    {
        using var server = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var salt = RandomNumberGenerator.GetBytes(16);
        var message = Encoding.UTF8.GetBytes("When I grow up, I want to be a watermelon");

        var body = WebPushCrypto.Encrypt(message, UserPublicKey, AuthSecretBytes, server, salt);

        Assert.Equal(salt, body[..16]);
        Assert.Equal(4096u, BinaryPrimitives.ReadUInt32BigEndian(body.AsSpan(16, 4)));
        Assert.Equal(65, body[20]);
        Assert.Equal(PublicPoint(server), body[21..86]);
        Assert.Equal(86 + message.Length + 1 + 16, body.Length);
        Assert.Equal(message, Decrypt(body, User, AuthSecretBytes));
    }

    [Fact]
    public void Encrypted_message_decrypts_with_the_subscription_keys()
    {
        var message = "Olá — REF 2 — 12:30 ✓"u8.ToArray();

        var body = WebPushCrypto.Encrypt(message, UserPublicKey, AuthSecretBytes);

        Assert.Equal(message, Decrypt(body, User, AuthSecretBytes));
    }

    [Fact]
    public void Each_message_gets_its_own_salt_and_sender_key()
    {
        var a = WebPushCrypto.Encrypt("x"u8, UserPublicKey, AuthSecretBytes);
        var b = WebPushCrypto.Encrypt("x"u8, UserPublicKey, AuthSecretBytes);

        Assert.NotEqual(a[..16], b[..16]);
        Assert.NotEqual(a[21..86], b[21..86]);
    }

    [Fact]
    public void Encrypt_rejects_what_does_not_fit_or_is_not_a_key()
    {
        Assert.Throws<ArgumentException>(() => WebPushCrypto.Encrypt(new byte[WebPushCrypto.MaxPlaintextLength + 1], UserPublicKey, AuthSecretBytes));
        Assert.Throws<ArgumentException>(() => WebPushCrypto.Encrypt("x"u8, new byte[65], AuthSecretBytes));
        Assert.Throws<ArgumentException>(() => WebPushCrypto.Encrypt("x"u8, UserPublicKey, new byte[15]));
        _ = WebPushCrypto.Encrypt(new byte[WebPushCrypto.MaxPlaintextLength], UserPublicKey, AuthSecretBytes);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not base64 !!")]
    [InlineData("AAAA=")]
    public void TryDecode_refuses_invalid_input(string? text) => Assert.Null(WebPushCrypto.TryDecode(text));

    [Fact]
    public void Vapid_keys_have_the_expected_shape_and_differ_each_time()
    {
        var (publicKey, privateKey) = Vapid.GenerateKeys();

        var pub = B(publicKey);
        Assert.Equal(65, pub.Length);
        Assert.Equal(0x04, pub[0]);
        Assert.Equal(32, B(privateKey).Length);
        Assert.NotEqual(publicKey, Vapid.GenerateKeys().PublicKey);
    }

    [Fact]
    public void Vapid_authorization_is_a_valid_es256_jwt_for_the_push_service_origin()
    {
        var (publicKey, privateKey) = Vapid.GenerateKeys();
        var now = new DateTimeOffset(2026, 3, 10, 15, 30, 0, TimeSpan.Zero);

        var header = Vapid.AuthorizationHeader(new Uri("https://fcm.googleapis.com/fcm/send/abc"), new VapidDetails("mailto:admin@example.test", publicKey, privateKey), now);

        Assert.StartsWith("vapid t=", header, StringComparison.Ordinal);
        var parts = header["vapid t=".Length..].Split(", k=");
        Assert.Equal(publicKey, parts[1]);
        var jwt = parts[0].Split('.');
        Assert.Equal(3, jwt.Length);
        Assert.Equal("""{"typ":"JWT","alg":"ES256"}""", Encoding.UTF8.GetString(B(jwt[0])));
        var claims = JsonDocument.Parse(B(jwt[1])).RootElement;
        Assert.Equal("https://fcm.googleapis.com", claims.GetProperty("aud").GetString());
        Assert.Equal("mailto:admin@example.test", claims.GetProperty("sub").GetString());
        Assert.Equal(now.AddHours(12).ToUnixTimeSeconds(), claims.GetProperty("exp").GetInt64());

        var pub = B(publicKey);
        using var verifier = ECDsa.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = pub[1..33], Y = pub[33..65] } });
        Assert.True(verifier.VerifyData(
            Encoding.ASCII.GetBytes($"{jwt[0]}.{jwt[1]}"), B(jwt[2]), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    }

    /// <summary>Receiver side of RFC 8291 / RFC 8188 for a single record, written from the RFCs to check the sender against.</summary>
    internal static byte[] Decrypt(byte[] body, ECDiffieHellman user, byte[] authSecret)
    {
        var salt = body[..16];
        Assert.Equal(4096u, BinaryPrimitives.ReadUInt32BigEndian(body.AsSpan(16, 4)));
        var idLength = body[20];
        var senderPublic = body[21..(21 + idLength)];
        var record = body[(21 + idLength)..];

        using var sender = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = senderPublic[1..33], Y = senderPublic[33..65] },
        });
        var shared = user.DeriveRawSecretAgreement(sender.PublicKey);
        var userPoint = user.ExportParameters(false).Q;
        var userPublic = new byte[] { 0x04 }.Concat(userPoint.X!).Concat(userPoint.Y!).ToArray();

        var ikm = HKDF.Expand(
            HashAlgorithmName.SHA256,
            HKDF.Extract(HashAlgorithmName.SHA256, shared, authSecret),
            32,
            Encoding.ASCII.GetBytes("WebPush: info\0").Concat(userPublic).Concat(senderPublic).ToArray());
        var prk = HKDF.Extract(HashAlgorithmName.SHA256, ikm, salt);
        var cek = HKDF.Expand(HashAlgorithmName.SHA256, prk, 16, Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"));
        var nonce = HKDF.Expand(HashAlgorithmName.SHA256, prk, 12, Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"));

        var cipher = record[..^16];
        var plain = new byte[cipher.Length];
        using (var aes = new AesGcm(cek, 16))
            aes.Decrypt(nonce, cipher, record[^16..], plain);

        Assert.Equal(0x02, plain[^1]);
        return plain[..^1];
    }
}
