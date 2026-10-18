namespace ProtocoloApp.Api.Features.Auth;

public sealed record LoginRequest(string Email, string Password);

public sealed record RefreshRequest(string RefreshToken);

public sealed record TokenResponse(string AccessToken, DateTimeOffset AccessTokenExpiresAt, string RefreshToken);

public sealed record MeResponse(Guid Id, string Email);
