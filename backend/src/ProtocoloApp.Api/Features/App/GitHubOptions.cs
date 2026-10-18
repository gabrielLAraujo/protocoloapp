namespace ProtocoloApp.Api.Features.App;

/// <summary>Where the app releases live (section <c>GitHub</c>). Production sets <c>GitHub__Token</c>.</summary>
public sealed class GitHubOptions
{
    public const string Section = "GitHub";

    /// <summary>Fine-grained token with read-only access to the contents of the repository (it is private). Empty disables the update check.</summary>
    public string Token { get; set; } = "";

    /// <summary>The repository whose releases carry the APK, as <c>owner/name</c>.</summary>
    public string Repository { get; set; } = "gabrielLAraujo/protocoloapp";
}
