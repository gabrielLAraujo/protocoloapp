using Microsoft.AspNetCore.Identity;
using ProtocoloApp.Api.Shared.Data;
using ProtocoloApp.Api.Shared.Http;

namespace ProtocoloApp.Api.Features.Auth;

public static class AuthEndpoints
{
    private const string InvalidCredentials = "E-mail ou senha inválidos.";
    private const string InvalidSession = "Sessão inválida ou expirada. Entre novamente.";

    // Verified against when the e-mail does not exist, so a miss costs as much as a wrong password.
    private static readonly AppUser DummyUser = new();
    private static string? _dummyHash;

    public static void MapAuth(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        var group = api.MapGroup("/auth").WithTags("Auth");

        group.MapPost("/login", LoginAsync).AllowAnonymous().RequireRateLimiting(RateLimitSetup.AuthPolicy);
        group.MapPost("/refresh", RefreshAsync).AllowAnonymous().RequireRateLimiting(RateLimitSetup.AuthPolicy);
        // Possession of the refresh token is the proof here: the access token may already have expired.
        group.MapPost("/logout", LogoutAsync).AllowAnonymous();
        group.MapGet("/me", MeAsync);
    }

    private static async Task<IResult> LoginAsync(LoginRequest request, UserManager<AppUser> users, TokenService tokens, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["credentials"] = ["Informe e-mail e senha."] });

        var user = await users.FindByEmailAsync(request.Email);
        if (user is null)
        {
            _dummyHash ??= users.PasswordHasher.HashPassword(DummyUser, "dummy-password-for-timing");
            users.PasswordHasher.VerifyHashedPassword(DummyUser, _dummyHash, request.Password);
            return Unauthorized(InvalidCredentials);
        }

        // A locked account answers exactly like a wrong password.
        if (await users.IsLockedOutAsync(user))
            return Unauthorized(InvalidCredentials);

        if (!await users.CheckPasswordAsync(user, request.Password))
        {
            await users.AccessFailedAsync(user);
            return Unauthorized(InvalidCredentials);
        }

        await users.ResetAccessFailedCountAsync(user);
        return Results.Ok(Issue(user, await tokens.IssueRefreshTokenAsync(user.Id, null, ct), tokens));
    }

    private static async Task<IResult> RefreshAsync(RefreshRequest request, UserManager<AppUser> users, TokenService tokens, CancellationToken ct)
    {
        try
        {
            var (userId, refreshToken) = await tokens.RotateAsync(request.RefreshToken ?? "", ct);
            var user = await users.FindByIdAsync(userId.ToString());
            return user is null ? Unauthorized(InvalidSession) : Results.Ok(Issue(user, refreshToken, tokens));
        }
        catch (InvalidRefreshTokenException)
        {
            return Unauthorized(InvalidSession);
        }
    }

    private static async Task<IResult> LogoutAsync(RefreshRequest request, TokenService tokens, CancellationToken ct)
    {
        await tokens.RevokeFamilyAsync(request.RefreshToken ?? "", ct);
        return Results.NoContent();
    }

    private static async Task<IResult> MeAsync(System.Security.Claims.ClaimsPrincipal principal, UserManager<AppUser> users)
    {
        var user = await users.FindByIdAsync(principal.GetUserId().ToString());
        return user is null ? Results.Unauthorized() : Results.Ok(new MeResponse(user.Id, user.Email ?? ""));
    }

    private static TokenResponse Issue(AppUser user, string refreshToken, TokenService tokens)
    {
        var (accessToken, expiresAt) = tokens.CreateAccessToken(user);
        return new TokenResponse(accessToken, expiresAt, refreshToken);
    }

    private static IResult Unauthorized(string detail) =>
        Results.Problem(title: "Não autorizado", detail: detail, statusCode: StatusCodes.Status401Unauthorized);
}
