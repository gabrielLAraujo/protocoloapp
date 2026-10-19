namespace ProtocoloApp.Api.Shared.Storage;

/// <summary>Cloudflare R2 settings (section <c>R2</c>). Production sets them as <c>R2__AccountId</c> and so on.</summary>
public sealed class StorageOptions
{
    public const string Section = "R2";

    public string AccountId { get; set; } = "";

    public string AccessKeyId { get; set; } = "";

    public string SecretAccessKey { get; set; } = "";

    public string Bucket { get; set; } = "";

    /// <summary>Replaces the account endpoint with another S3-compatible server (the e2e storage stub). Unset in production.</summary>
    public Uri? ServiceUrl { get; set; }

    /// <summary>The S3-compatible endpoint of the account.</summary>
    public Uri Endpoint => ServiceUrl ?? new($"https://{AccountId}.r2.cloudflarestorage.com");
}
