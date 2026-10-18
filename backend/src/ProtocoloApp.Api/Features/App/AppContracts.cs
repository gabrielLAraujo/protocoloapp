namespace ProtocoloApp.Api.Features.App;

/// <summary>The newest published version of the Android app and where to download it from (this API, not GitHub).</summary>
public sealed record LatestReleaseResponse(string Version, Uri ApkUrl);
