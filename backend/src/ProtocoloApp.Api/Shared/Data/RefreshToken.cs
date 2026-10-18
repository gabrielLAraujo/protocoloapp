namespace ProtocoloApp.Api.Shared.Data;

/// <summary>
/// One link of a refresh-token chain. Each use revokes the token and issues the next one in the same <see cref="FamilyId"/>;
/// only the SHA-256 of the token is stored.
/// </summary>
public class RefreshToken
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    /// <summary>All tokens descending from one login. Reusing a revoked token revokes the whole family.</summary>
    public Guid FamilyId { get; set; }

    public string TokenHash { get; set; } = "";

    public DateTimeOffset ExpiresAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }

    /// <summary>The token issued when this one was rotated, if it was.</summary>
    public Guid? ReplacedById { get; set; }
}
