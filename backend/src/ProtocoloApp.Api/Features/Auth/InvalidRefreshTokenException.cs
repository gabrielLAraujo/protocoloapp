namespace ProtocoloApp.Api.Features.Auth;

/// <summary>The refresh token is unknown, expired, revoked or was already used. The endpoint turns it into a 401.</summary>
public sealed class InvalidRefreshTokenException : Exception
{
    public InvalidRefreshTokenException()
        : base("Invalid refresh token.")
    {
    }

    public InvalidRefreshTokenException(string message)
        : base(message)
    {
    }

    public InvalidRefreshTokenException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
