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

    /// <summary>
    /// How long after a token was spent its owner may present it again (the response with the successor was lost: weak
    /// signal at the gym) as long as that successor was never used.
    /// </summary>
    public static readonly TimeSpan ReuseGrace = TimeSpan.FromSeconds(60);

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
    /// (leak or race): the whole family is revoked and the call fails, except within <see cref="ReuseGrace"/> of the spend
    /// while its successor was never used. Then the successor is revoked and the family rotates again, so at most one live
    /// refresh token exists per family at any time (two simultaneous refreshes both succeed, but only the later one's
    /// token stays alive; using the earlier one afterwards is a reuse).
    /// </summary>
    /// <exception cref="InvalidRefreshTokenException">Unknown, expired, revoked or reused token.</exception>
    public async Task<(Guid UserId, string RefreshToken)> RotateAsync(string rawToken, CancellationToken cancellationToken = default)
    {
        var token = await FindAsync(rawToken, cancellationToken) ?? throw new InvalidRefreshTokenException();
        var now = clock.GetUtcNow();

        // Rotation and family revocation serialize on the family's advisory lock, so a token issued here can never
        // survive a concurrent revoke of its family.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockFamilyAsync(token.FamilyId, cancellationToken);

        // Single conditional UPDATE: of two concurrent uses of the same token only one wins.
        var spent = await db.RefreshTokens
            .Where(t => t.Id == token.Id && t.RevokedAt == null && t.ExpiresAt > now)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), cancellationToken);

        if (spent == 0)
        {
            // Read again under the lock: the copy above may predate the spend.
            var current = await db.RefreshTokens.AsNoTracking().SingleAsync(t => t.Id == token.Id, cancellationToken);
            if (await TryRevokeUnusedSuccessorAsync(current, now, cancellationToken))
            {
                var retried = await IssueSuccessorAsync(current, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return (current.UserId, retried);
            }

            // The row was unrevoked when read, so 0 rows means someone spent or revoked it in between: that is a reuse
            // too. Only a plainly expired token fails without taking the family down.
            if (current.ExpiresAt > now)
                await RevokeFamilyRowsAsync(current.FamilyId, cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            throw new InvalidRefreshTokenException();
        }

        var nextRaw = await IssueSuccessorAsync(token, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return (token.UserId, nextRaw);
    }

    /// <summary>
    /// The grace for a lost response: <paramref name="token"/> was spent (not revoked: it has a successor) at most
    /// <see cref="ReuseGrace"/> ago, and its successor is still unused. Revokes that successor and returns true.
    /// </summary>
    private async Task<bool> TryRevokeUnusedSuccessorAsync(RefreshToken token, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (token.ExpiresAt <= now || token.RevokedAt is not { } spentAt || token.ReplacedById is not { } successorId)
            return false;
        if (now - spentAt > ReuseGrace)
            return false;

        // Unused = never spent nor revoked. Conditional, under the family lock: nobody can use it meanwhile.
        var revoked = await db.RefreshTokens
            .Where(t => t.Id == successorId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), cancellationToken);
        return revoked == 1;
    }

    /// <summary>Issues the next token of <paramref name="token"/>'s family and records it as its successor.</summary>
    private async Task<string> IssueSuccessorAsync(RefreshToken token, CancellationToken cancellationToken)
    {
        var (nextId, nextRaw) = await IssueAsync(token.UserId, token.FamilyId, cancellationToken);
        await db.RefreshTokens.Where(t => t.Id == token.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.ReplacedById, nextId), cancellationToken);
        return nextRaw;
    }

    /// <summary>Logout: revokes the family of the token. Unknown tokens are ignored (idempotent, reveals nothing).</summary>
    public async Task RevokeFamilyAsync(string rawToken, CancellationToken cancellationToken = default)
    {
        var token = await FindAsync(rawToken, cancellationToken);
        if (token is null)
            return;

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        await LockFamilyAsync(token.FamilyId, cancellationToken);
        await RevokeFamilyRowsAsync(token.FamilyId, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
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

    // Transaction-scoped: released on commit or rollback.
    private Task<int> LockFamilyAsync(Guid familyId, CancellationToken cancellationToken)
    {
        var key = familyId.ToString();
        return db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({key}))", cancellationToken);
    }

    private async Task RevokeFamilyRowsAsync(Guid familyId, CancellationToken cancellationToken)
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
