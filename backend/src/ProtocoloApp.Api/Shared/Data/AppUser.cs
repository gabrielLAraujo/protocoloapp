using Microsoft.AspNetCore.Identity;

namespace ProtocoloApp.Api.Shared.Data;

/// <summary>The single account of the app. There is no public sign-up: it is created by the <c>create-user</c> command.</summary>
public class AppUser : IdentityUser<Guid>;
