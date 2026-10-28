using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ProtocoloApp.Api.Features.Integrations.Secrets;
using ProtocoloApp.Api.Features.Updates;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Integrations.Hevy;

/// <summary>Rules shared by the connection endpoints and the importer. Never logs the key nor workout content.</summary>
public static class HevyConnections
{
    /// <summary>Days before today the first import starts at when there is no open update cycle.</summary>
    public const int DefaultDaysBack = 30;

    private static readonly JsonSerializerOptions ResultJson = new(JsonSerializerDefaults.Web);

    /// <summary>The AAD the key of <paramref name="userId"/> is encrypted with (a cipher of one user does not open as another's).</summary>
    public static string Purpose(Guid userId) => $"hevy:{userId}";

    /// <summary>
    /// The default first-import date: <c>period_start</c> of the most recent update cycle not sent yet; without one,
    /// <paramref name="today"/> − 30 days.
    /// </summary>
    public static async Task<DateOnly> DefaultSyncFromAsync(AppDbContext db, Guid userId, DateOnly today, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);

        var start = await db.UpdateCycles
            .Where(c => c.UserId == userId && c.DeletedAt == null && c.Status != UpdateCycleStatus.Sent)
            .OrderByDescending(c => c.PeriodStart)
            .Select(c => (DateOnly?)c.PeriodStart)
            .FirstOrDefaultAsync(ct);
        return start ?? today.AddDays(-DefaultDaysBack);
    }

    /// <summary>The plain API key, or null when it does not open (no encryption key, or another one than it was saved with).</summary>
    public static string? ReadKey(HevyConnection connection, ISecretProtector protector)
    {
        ArgumentNullException.ThrowIfNull(connection);
        ArgumentNullException.ThrowIfNull(protector);

        return protector.TryUnprotect(connection.ApiKeyCipher, Purpose(connection.UserId), out var key) ? key : null;
    }

    /// <summary>
    /// The last 4 characters shown in the status. The <c>PUT</c> only takes keys of <see cref="HevyConnectionEndpoints.MinApiKeyLength"/>
    /// characters or more, so these never give the whole key away.
    /// </summary>
    public static string Last4(string apiKey)
    {
        ArgumentNullException.ThrowIfNull(apiKey);

        return apiKey.Length > HevyConnection.KeyLast4Length ? apiKey[^HevyConnection.KeyLast4Length..] : apiKey;
    }

    /// <summary>The <c>last_result</c> column value of a run.</summary>
    public static JsonDocument WriteResult(HevySyncResult result) => JsonSerializer.SerializeToDocument(result, ResultJson);

    /// <summary>The counts stored in <c>last_result</c>, or null when absent or unreadable.</summary>
    public static HevySyncResult? ReadResult(JsonDocument? document)
    {
        if (document is null)
            return null;

        try
        {
            return document.Deserialize<HevySyncResult>(ResultJson);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>The stored error code (<c>unauthorized</c>, <c>rate_limited</c>...) as the enum, null when unknown or absent.</summary>
    public static HevyErrorCode? ParseError(string? code) => code switch
    {
        "unauthorized" => HevyErrorCode.Unauthorized,
        "rate_limited" => HevyErrorCode.RateLimited,
        "unavailable" => HevyErrorCode.Unavailable,
        "format" => HevyErrorCode.Format,
        "key_unreadable" => HevyErrorCode.KeyUnreadable,
        "incomplete" => HevyErrorCode.Incomplete,
        "internal" => HevyErrorCode.Internal,
        _ => null,
    };

    /// <summary>The code stored in <c>last_error</c> for a client error.</summary>
    public static string ErrorCode(HevyError error) => error switch
    {
        HevyError.Unauthorized => "unauthorized",
        HevyError.RateLimited => "rate_limited",
        HevyError.Unavailable => "unavailable",
        _ => "format",
    };
}
