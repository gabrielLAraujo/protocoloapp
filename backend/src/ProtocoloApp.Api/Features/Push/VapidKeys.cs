using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Push;

/// <summary>The server's VAPID key pair, generated on first use and kept in <c>app_secrets</c>.</summary>
public static class VapidKeys
{
    public const string SecretName = "vapid";

    private sealed record Stored(string PublicKey, string PrivateKey);

    /// <summary>
    /// Reads the pair, creating it the first time. Two callers racing both generate a pair, one insert wins
    /// (<c>ON CONFLICT DO NOTHING</c>) and both read the winner back.
    /// </summary>
    public static async Task<(string PublicKey, string PrivateKey)> GetOrCreateAsync(AppDbContext db, TimeProvider clock, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(clock);

        if (await ReadAsync(db, ct) is { } existing)
            return existing;

        var generated = Vapid.GenerateKeys();
        var json = JsonSerializer.Serialize(new Stored(generated.PublicKey, generated.PrivateKey));
        var now = clock.GetUtcNow();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO app_secrets (name, value, created_at) VALUES ({SecretName}, {json}, {now}) ON CONFLICT (name) DO NOTHING", ct);

        return await ReadAsync(db, ct) ?? throw new InvalidOperationException("The VAPID keys could not be stored.");
    }

    private static async Task<(string PublicKey, string PrivateKey)?> ReadAsync(AppDbContext db, CancellationToken ct)
    {
        var secret = await db.AppSecrets.AsNoTracking().SingleOrDefaultAsync(s => s.Name == SecretName, ct);
        if (secret is null)
            return null;

        var stored = JsonSerializer.Deserialize<Stored>(secret.Value)!;
        return (stored.PublicKey, stored.PrivateKey);
    }
}
