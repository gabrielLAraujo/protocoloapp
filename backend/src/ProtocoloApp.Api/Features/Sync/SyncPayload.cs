using System.Text.Json;
using FluentValidation;

namespace ProtocoloApp.Api.Features.Sync;

/// <summary>Reads and writes entity payloads: snake_case JSON, dates as <c>yyyy-MM-dd</c>, numbers as JSON numbers.</summary>
public static class SyncPayload
{
    public static JsonSerializerOptions Options { get; } = new(JsonSerializerDefaults.General)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    /// <summary>
    /// Deserializes and validates <paramref name="json"/>. On failure returns null and the error codes
    /// (<c>invalid_payload</c> or <c>invalid_payload:&lt;field&gt;</c>, field in snake_case).
    /// </summary>
    public static T? Read<T>(JsonElement? json, IValidator<T> validator, out IReadOnlyList<string> errors) where T : class
    {
        ArgumentNullException.ThrowIfNull(validator);

        if (json is not { ValueKind: JsonValueKind.Object } element)
        {
            errors = [SyncErrors.InvalidPayload];
            return null;
        }

        T? payload;
        try
        {
            payload = element.Deserialize<T>(Options);
        }
        catch (JsonException ex)
        {
            errors = [FieldError(ex.Path)];
            return null;
        }

        if (payload is null)
        {
            errors = [SyncErrors.InvalidPayload];
            return null;
        }

        errors = validator.Validate(payload).Errors
            .Select(f => SyncErrors.InvalidPayloadField(f.PropertyName))
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return errors.Count == 0 ? payload : null;
    }

    public static JsonElement Write<T>(T payload) => JsonSerializer.SerializeToElement(payload, Options);

    // "$.sleep_quality" -> invalid_payload:sleep_quality; anything less specific -> invalid_payload.
    private static string FieldError(string? path)
    {
        if (path is null || !path.StartsWith("$.", StringComparison.Ordinal))
            return SyncErrors.InvalidPayload;

        var field = path[2..];
        var end = field.IndexOfAny(['.', '[']);
        if (end >= 0)
            field = field[..end];
        return field.Length == 0 ? SyncErrors.InvalidPayload : SyncErrors.InvalidPayloadField(field);
    }
}
