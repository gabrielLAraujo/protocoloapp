namespace ProtocoloApp.Api.Features.App;

/// <summary>GitHub cannot answer right now: not configured, unreachable, a non-success status or an unreadable body.</summary>
public sealed class GitHubUnavailableException : Exception
{
    public GitHubUnavailableException()
    {
    }

    public GitHubUnavailableException(string message)
        : base(message)
    {
    }

    public GitHubUnavailableException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
