using Microsoft.EntityFrameworkCore;

namespace ProtocoloApp.Api.Shared.Data;

/// <summary>Application database. Starts empty; the auth task turns it into an Identity context and features add their sets.</summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options);
