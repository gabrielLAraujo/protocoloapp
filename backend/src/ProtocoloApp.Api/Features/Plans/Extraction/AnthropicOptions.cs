namespace ProtocoloApp.Api.Features.Plans.Extraction;

/// <summary>Settings of the Anthropic Messages API client (<c>Anthropic:*</c>). Without <see cref="ApiKey"/> the import is unavailable.</summary>
public sealed class AnthropicOptions
{
    public const string Section = "Anthropic";

    public string? ApiKey { get; set; }

    public string Model { get; set; } = "claude-sonnet-5-5";

    public string BaseUrl { get; set; } = "https://api.anthropic.com";

    public string Version { get; set; } = "2023-06-01";

    public int MaxTokens { get; set; } = 16000;

    /// <summary>Per attempt. Tests inject a short one.</summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(90);

    /// <summary>Wait before the single retry after 429/503/529. Tests inject zero.</summary>
    public TimeSpan RetryDelay { get; set; } = TimeSpan.FromSeconds(2);

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiKey);
}
