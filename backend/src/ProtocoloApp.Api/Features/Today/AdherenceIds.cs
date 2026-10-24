using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace ProtocoloApp.Api.Features.Today;

/// <summary>
/// The deterministic id of an adherence mark, the twin of the front's <c>adherenceLogId</c> (<c>frontend/src/data/ids.ts</c>):
/// a UUID v5 of <c>{userId}:adherence:{yyyy-MM-dd}:{targetType}:{targetKey}</c> in the fixed check-in namespace. A mark the
/// server writes then has the same id a device would give it, so both converge on one row.
/// </summary>
public static class AdherenceIds
{
    /// <summary>The front's <c>CHECKIN_NAMESPACE</c>. Never change it.</summary>
    public static readonly Guid Namespace = new("6f1c0b8e-3a52-4d7e-9a61-1f2b8c7d4e90");

    public static Guid For(Guid userId, DateOnly date, string targetType, string targetKey) =>
        NameBased(Namespace, string.Create(CultureInfo.InvariantCulture, $"{userId:D}:adherence:{date:yyyy-MM-dd}:{targetType}:{targetKey}"));

    /// <summary>RFC 4122 version 5 (SHA-1), as the <c>uuid</c> package's <c>v5</c>.</summary>
    internal static Guid NameBased(Guid ns, string name)
    {
        var nameBytes = Encoding.UTF8.GetBytes(name);
        var input = new byte[16 + nameBytes.Length];
        ns.TryWriteBytes(input, bigEndian: true, out _);
        nameBytes.CopyTo(input, 16);

#pragma warning disable CA5350 // SHA-1 is what UUID v5 is defined with; this is an id, not a security boundary.
        var hash = SHA1.HashData(input);
#pragma warning restore CA5350

        var bytes = hash.AsSpan(0, 16).ToArray();
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes, bigEndian: true);
    }
}
