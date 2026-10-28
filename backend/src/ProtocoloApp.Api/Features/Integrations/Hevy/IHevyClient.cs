namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>
/// The Hevy public API (<c>api-key</c> header). Every call returns an error code instead of throwing, except when the
/// caller's token is cancelled. The key is never logged.
/// </summary>
public interface IHevyClient
{
    /// <summary><c>GET /v1/user/info</c>: null when Hevy accepts the key.</summary>
    Task<HevyError?> CheckKeyAsync(string apiKey, CancellationToken ct);

    /// <summary><c>GET /v1/workouts?page&amp;pageSize=10</c>, newest first.</summary>
    Task<HevyResult<HevyPage<HevyWorkout>>> GetWorkoutsAsync(string apiKey, int page, CancellationToken ct);

    /// <summary><c>GET /v1/workouts/events?page&amp;pageSize=10&amp;since</c> (<paramref name="since"/> sent in UTC).</summary>
    Task<HevyResult<HevyPage<HevyEvent>>> GetEventsAsync(string apiKey, DateTimeOffset since, int page, CancellationToken ct);

    /// <summary><c>GET /v1/workouts/{id}</c>.</summary>
    Task<HevyResult<HevyWorkout>> GetWorkoutAsync(string apiKey, string id, CancellationToken ct);

    /// <summary><c>GET /v1/exercise_templates?page&amp;pageSize=100</c>.</summary>
    Task<HevyResult<HevyPage<HevyTemplate>>> GetTemplatesAsync(string apiKey, int page, CancellationToken ct);
}
