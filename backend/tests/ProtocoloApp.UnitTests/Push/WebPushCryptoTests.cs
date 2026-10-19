using System.Buffers.Binary;
using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ProtocoloApp.Api.Features.Push;

namespace ProtocoloApp.UnitTests.Push;

public sealed class WebPushCryptoTests
{
    // RFC 8291 appendix A: the example message and keys (public test vectors), written as hex.
    private const string AppServerPrivate = "C9F58F89813E9F8E872E71F42AA64E1757C9254DCC62B72DDC010BB4043EA11C";
    private const string AppServerPublic = "04FE33F4AB0DEA71914DB55823F73B54948F41306D920732DBB9A59A53286482200E597A7B7BC260BA1C227998580992E93973002F3012A28AE8F06BBB78E5EC0F";
    private const string UserPrivate = "AB5757A70DD4A53E553A6BBF71FFEFEA2874EC07A6B379E3C48F895A02DC33DE";
    private const string UserPublic = "042571B2BECDFDE360551AAF1ED0F4CD366C11CEBE555F89BCB7B186A53339173168ECE2EBE018597BD30479B86E3C8F8ECED577CA59187E9246990DB682008B0E";
    private const string AuthSecret = "05305932A1C7EABE13B6CEC9FDA48882";
    private const string Salt = "0C6BFAADAD67958803092D454676F397";
    private const string Expected =
        "0C6BFAADAD67958803092D454676F397000010004104FE33F4AB0DEA71914DB55823F73B54948F41306D920732DBB9A59A53286482200E597A7B7BC260BA1C227998580992E93973002F3012A28AE8F06BBB78E5EC0FF297DE5B429BBA7153D3A4AE0CAA091FD425F3B4B5414ADD8AB37A19C1BBB05CF5CB5B2A2E0562D558635641EC52812C6C8FF42E95CCB86BE7CD";

    private static byte[] H(string hex) => Convert.FromHexString(hex);

    private static byte[] B(string base64Url) => Base64Url.DecodeFromChars(base64Url);

    private static ECDiffieHellman Key(string privateKey, string publicKey)
    {
        var pub = H(publicKey);
        return ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            D = H(privateKey),
            Q = new ECPoint { X = pub[1..33], Y = pub[33..65] },
        });
    }

    [Fact]
    public void Encrypt_reproduces_the_rfc_8291_example()
    {
        using var server = Key(AppServerPrivate, AppServerPublic);

        var body = WebPushCrypto.Encrypt(Encoding.UTF8.GetBytes("When I grow up, I want to be a watermelon"), H(UserPublic), H(AuthSecret), server, H(Salt));

        Assert.Equal(Expected, Convert.ToHexString(body));
    }

    [Fact]
    public void Encrypted_message_decrypts_with_the_subscription_keys()
    {
        using var user = Key(UserPrivate, UserPublic);
        var message = "Olá — REF 2 — 12:30 ✓"u8.ToArray();

        var body = WebPushCrypto.Encrypt(message, H(UserPublic), H(AuthSecret));

        Assert.Equal(message, Decrypt(body, user, H(AuthSecret)));
    }

    [Fact]
    public void Each_message_gets_its_own_salt_and_sender_key()
    {
        var a = WebPushCrypto.Encrypt("x"u8, H(UserPublic), H(AuthSecret));
        var b = WebPushCrypto.Encrypt("x"u8, H(UserPublic), H(AuthSecret));

        Assert.NotEqual(a[..16], b[..16]);
        Assert.NotEqual(a[21..86], b[21..86]);
    }

    [Fact]
    public void Encrypt_rejects_what_does_not_fit_or_is_not_a_key()
    {
        Assert.Throws<ArgumentException>(() => WebPushCrypto.Encrypt(new byte[WebPushCrypto.MaxPlaintextLength + 1], H(UserPublic), H(AuthSecret)));
        Assert.Throws<ArgumentException>(() => WebPushCrypto.Encrypt("x"u8, new byte[65], H(AuthSecret)));
        Assert.Throws<ArgumentException>(() => WebPushCrypto.Encrypt("x"u8, H(UserPublic), new byte[15]));
        _ = WebPushCrypto.Encrypt(new byte[WebPushCrypto.MaxPlaintextLength], H(UserPublic), H(AuthSecret));
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
