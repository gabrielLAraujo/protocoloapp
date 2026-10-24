using System.Collections.Concurrent;
using ProtocoloApp.Api.Features.Integrations.Hevy;

namespace ProtocoloApp.IntegrationTests.Infra;

/// <summary>
/// An <see cref="IHevyClient"/> that reaches nothing. <see cref="CheckKeyAsync"/> accepts every key unless
/// <see cref="KeyErrors"/> says otherwise; the other calls answer empty pages.
/// </summary>
public sealed class FakeHevyClient : IHevyClient
{
    /// <summary>What <see cref="CheckKeyAsync"/> answers for a key; keys not listed are accepted.</summary>
    public ConcurrentDictionary<string, HevyError> KeyErrors { get; } = new(StringComparer.Ordinal);

    /// <summary>Every key that was checked, in order.</summary>
    public ConcurrentQueue<string> CheckedKeys { get; } = new();

    public Task<HevyError?> CheckKeyAsync(string apiKey, CancellationToken ct)
    {
        CheckedKeys.Enqueue(apiKey);
        return Task.FromResult(KeyErrors.TryGetValue(apiKey, out var error) ? error : (HevyError?)null);
    }

    public Task<HevyResult<HevyPage<HevyWorkout>>> GetWorkoutsAsync(string apiKey, int page, CancellationToken ct) =>
        Task.FromResult(HevyResult<HevyPage<HevyWorkout>>.Ok(new HevyPage<HevyWorkout>([], page, 0, 0)));

    public Task<HevyResult<HevyPage<HevyEvent>>> GetEventsAsync(string apiKey, DateTimeOffset since, int page, CancellationToken ct) =>
        Task.FromResult(HevyResult<HevyPage<HevyEvent>>.Ok(new HevyPage<HevyEvent>([], page, 0, 0)));

    public Task<HevyResult<HevyWorkout>> GetWorkoutAsync(string apiKey, string id, CancellationToken ct) =>
        Task.FromResult(HevyResult<HevyWorkout>.Fail(HevyError.Unavailable));

    public Task<HevyResult<HevyPage<HevyTemplate>>> GetTemplatesAsync(string apiKey, int page, CancellationToken ct) =>
        Task.FromResult(HevyResult<HevyPage<HevyTemplate>>.Ok(new HevyPage<HevyTemplate>([], page, 0, 0)));
}
