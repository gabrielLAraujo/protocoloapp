using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Auth;

/// <summary>Issues the short-lived access JWT and the rotating, hash-only refresh tokens.</summary>
public sealed class TokenService(AppDbContext db, IOptions<AuthOptions> options, TimeProvider clock)
{
    public static readonly TimeSpan AccessTokenLifetime = TimeSpan.FromMinutes(15);
    public static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(30);

    private const int RefreshTokenBytes = 32;

    public (string Token, DateTimeOffset ExpiresAt) CreateAccessToken(AppUser user)
    {
        ArgumentNullException.ThrowIfNull(user);

        var settings = options.Value;
        var now = clock.GetUtcNow();
        var expiresAt = now + AccessTokenLifetime;

        var descriptor = new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Email, user.Email ?? ""),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            ]),
            Issuer = settings.Issuer,
            Audience = settings.Audience,
            NotBefore = now.UtcDateTime,
            Expires = expiresAt.UtcDateTime,
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(settings.SigningKey)), SecurityAlgorithms.HmacSha256),
        };

        return (new JsonWebTokenHandler().CreateToken(descriptor), expiresAt);
    }

    /// <summary>Creates a refresh token (a new family when <paramref name="familyId"/> is null) and returns its raw value, shown only once.</summary>
    public async Task<string> IssueRefreshTokenAsync(Guid userId, Guid? familyId = null, CancellationToken cancellationToken = default) =>
        (await IssueAsync(userId, familyId ?? Guid.CreateVersion7(), cancellationToken)).Raw;

    /// <summary>
    /// Spends <paramref name="rawToken"/> and issues the next one in its family. A token that was already spent is a reuse
    /// (leak or race): the whole family is revoked and the call fails.
    /// </summary>
    /// <exception cref="InvalidRefreshTokenException">Unknown, expired, revoked or reused token.</exception>
    public async Task<(Guid UserId, string RefreshToken)> RotateAsync(string rawToken, CancellationToken cancellationToken = default)
    {
        var token = await FindAsync(rawToken, cancellationToken) ?? throw new InvalidRefreshTokenException();
        var now = clock.GetUtcNow();

        // Single conditional UPDATE: of two concurrent uses of the same token only one wins, the other sees 0 rows.
        var spent = await db.RefreshTokens
            .Where(t => t.Id == token.Id && t.RevokedAt == null && t.ExpiresAt > now)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), cancellationToken);

        if (spent == 0)
        {
            if (token.RevokedAt is not null)
                await RevokeFamilyAsync(token.FamilyId, cancellationToken);

            throw new InvalidRefreshTokenException();
        }

        var (nextId, nextRaw) = await IssueAsync(token.UserId, token.FamilyId, cancellationToken);
        await db.RefreshTokens.Where(t => t.Id == token.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.ReplacedById, nextId), cancellationToken);

        return (token.UserId, nextRaw);
    }

    /// <summary>Logout: revokes the family of the token. Unknown tokens are ignored (idempotent, reveals nothing).</summary>
    public async Task RevokeFamilyAsync(string rawToken, CancellationToken cancellationToken = default)
    {
        var token = await FindAsync(rawToken, cancellationToken);
        if (token is not null)
            await RevokeFamilyAsync(token.FamilyId, cancellationToken);
    }

    private async Task<(Guid Id, string Raw)> IssueAsync(Guid userId, Guid familyId, CancellationToken cancellationToken)
    {
        var raw = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(RefreshTokenBytes));
        var id = Guid.CreateVersion7();
        db.RefreshTokens.Add(new RefreshToken
        {
            Id = id,
            UserId = userId,
            FamilyId = familyId,
            TokenHash = Hash(raw),
            ExpiresAt = clock.GetUtcNow() + RefreshTokenLifetime,
        });
        await db.SaveChangesAsync(cancellationToken);
        return (id, raw);
    }

    private async Task RevokeFamilyAsync(Guid familyId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        await db.RefreshTokens
            .Where(t => t.FamilyId == familyId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), cancellationToken);
    }

    private Task<RefreshToken?> FindAsync(string rawToken, CancellationToken cancellationToken)
    {
        var hash = Hash(rawToken);
        return db.RefreshTokens.AsNoTracking().SingleOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);
    }

    // Uppercase hex SHA-256 (64 chars): the token is random, so no salt is needed.
    private static string Hash(string rawToken) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));
}
