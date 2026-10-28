using System.Collections.Concurrent;
using ProtocoloApp.Api.Features.Integrations.Hevy;

namespace ProtocoloApp.IntegrationTests.Infra;

/// <summary>
/// An <see cref="IHevyClient"/> that reaches nothing. Answers are scripted per API key (each test uses keys of its own):
/// <see cref="CheckKeyAsync"/> accepts every key unless <see cref="KeyErrors"/> says otherwise; workouts, events and templates
/// come from <see cref="WorkoutPages"/>, <see cref="EventPages"/> and <see cref="Templates"/>, empty pages otherwise.
/// </summary>
public sealed class FakeHevyClient : IHevyClient
{
    /// <summary>What <see cref="CheckKeyAsync"/> answers for a key; keys not listed are accepted.</summary>
    public ConcurrentDictionary<string, HevyError> KeyErrors { get; } = new(StringComparer.Ordinal);

    /// <summary>Every key that was checked, in order.</summary>
    public ConcurrentQueue<string> CheckedKeys { get; } = new();

    /// <summary>The answer to <c>GET /v1/workouts?page</c> for a key.</summary>
    public ConcurrentDictionary<string, Func<int, HevyResult<HevyPage<HevyWorkout>>>> WorkoutPages { get; } = new(StringComparer.Ordinal);

    /// <summary>The answer to <c>GET /v1/workouts/events?since&amp;page</c> for a key.</summary>
    public ConcurrentDictionary<string, Func<DateTimeOffset, int, HevyResult<HevyPage<HevyEvent>>>> EventPages { get; } = new(StringComparer.Ordinal);

    /// <summary>The templates of a key, served in one page.</summary>
    public ConcurrentDictionary<string, IReadOnlyList<HevyTemplate>> Templates { get; } = new(StringComparer.Ordinal);

    /// <summary>
    /// A key whose workout calls wait: <c>Entered</c> completes when a call arrives, the call goes on once <c>Release</c> completes.
    /// </summary>
    public ConcurrentDictionary<string, (TaskCompletionSource Entered, TaskCompletionSource Release)> Gates { get; } = new(StringComparer.Ordinal);

    /// <summary>Every list call: the key, <c>workouts</c>/<c>events</c>/<c>templates</c>, the page and the <c>since</c> of events.</summary>
    public ConcurrentQueue<(string Key, string Call, int Page, DateTimeOffset? Since)> Calls { get; } = new();

    public Task<HevyError?> CheckKeyAsync(string apiKey, CancellationToken ct)
    {
        CheckedKeys.Enqueue(apiKey);
        return Task.FromResult(KeyErrors.TryGetValue(apiKey, out var error) ? error : (HevyError?)null);
    }

    public async Task<HevyResult<HevyPage<HevyWorkout>>> GetWorkoutsAsync(string apiKey, int page, CancellationToken ct)
    {
        Calls.Enqueue((apiKey, "workouts", page, null));
        if (Gates.TryGetValue(apiKey, out var gate))
        {
            gate.Entered.TrySetResult();
            await gate.Release.Task.WaitAsync(ct);
        }

        return WorkoutPages.TryGetValue(apiKey, out var pages)
            ? pages(page)
            : HevyResult<HevyPage<HevyWorkout>>.Ok(new HevyPage<HevyWorkout>([], page, 0, 0));
    }

    public Task<HevyResult<HevyPage<HevyEvent>>> GetEventsAsync(string apiKey, DateTimeOffset since, int page, CancellationToken ct)
    {
        Calls.Enqueue((apiKey, "events", page, since));
        return Task.FromResult(EventPages.TryGetValue(apiKey, out var pages)
            ? pages(since, page)
            : HevyResult<HevyPage<HevyEvent>>.Ok(new HevyPage<HevyEvent>([], page, 0, 0)));
    }

    public Task<HevyResult<HevyWorkout>> GetWorkoutAsync(string apiKey, string id, CancellationToken ct) =>
        Task.FromResult(HevyResult<HevyWorkout>.Fail(HevyError.Unavailable));

    public Task<HevyResult<HevyPage<HevyTemplate>>> GetTemplatesAsync(string apiKey, int page, CancellationToken ct)
    {
        Calls.Enqueue((apiKey, "templates", page, null));
        IReadOnlyList<HevyTemplate> items = page == 1 && Templates.TryGetValue(apiKey, out var templates) ? templates : [];
        return Task.FromResult(HevyResult<HevyPage<HevyTemplate>>.Ok(new HevyPage<HevyTemplate>(items, page, 1, 0)));
    }
}
