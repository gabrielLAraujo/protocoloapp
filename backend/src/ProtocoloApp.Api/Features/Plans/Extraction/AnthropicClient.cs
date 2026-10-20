using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace ProtocoloApp.Api.Features.Plans.Extraction;

public enum AnthropicCallStatus
{
    Ok,
    Timeout,
    Unavailable,
}

/// <summary>What the client learned from <c>error.message</c> of a non-2xx reply; the message itself never leaves the client.</summary>
public enum AnthropicErrorHint
{
    None,

    /// <summary>The account has no credits left ("Your credit balance is too low...").</summary>
    CreditBalance,
}

/// <summary><c>ToolInput</c> is the input of the first <c>tool_use</c> block (null when the reply has none or is malformed).</summary>
/// <remarks><c>StatusCode</c>/<c>ErrorType</c> are set on a non-2xx reply (<c>error.type</c> of the body and <c>ErrorHint</c>, a classification of <c>error.message</c>, nothing else of it); <c>StopReason</c> on a 2xx one.</remarks>
public sealed record AnthropicToolCall(
    AnthropicCallStatus Status,
    JsonDocument? ToolInput,
    int? StatusCode = null,
    string? ErrorType = null,
    string? StopReason = null,
    AnthropicErrorHint ErrorHint = AnthropicErrorHint.None);

/// <summary>Minimal Anthropic Messages API client: one message with a PDF and a forced tool.</summary>
public sealed class AnthropicClient(HttpClient http, IOptions<AnthropicOptions> options)
{
    private readonly AnthropicOptions _options = options.Value;

    public bool IsConfigured => _options.IsConfigured;

    public async Task<AnthropicToolCall> CallToolAsync(string toolName, JsonObject inputSchema, string prompt, string pdfBase64, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["model"] = _options.Model,
            ["max_tokens"] = _options.MaxTokens,
            ["tools"] = new JsonArray(new JsonObject
            {
                ["name"] = toolName,
                ["description"] = "Submit the structured data extracted from the PDF.",
                ["input_schema"] = inputSchema.DeepClone(),
            }),
            ["tool_choice"] = new JsonObject { ["type"] = "tool", ["name"] = toolName },
            ["messages"] = new JsonArray(new JsonObject
            {
                ["role"] = "user",
                ["content"] = new JsonArray(
                    new JsonObject
                    {
                        ["type"] = "document",
                        ["source"] = new JsonObject { ["type"] = "base64", ["media_type"] = "application/pdf", ["data"] = pdfBase64 },
                    },
                    new JsonObject { ["type"] = "text", ["text"] = prompt }),
            }),
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(_options.BaseUrl.TrimEnd('/') + "/"), "v1/messages"))
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.Add("x-api-key", _options.ApiKey);
        request.Headers.Add("anthropic-version", _options.Version);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(_options.Timeout);
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            var reply = await response.Content.ReadAsStringAsync(timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                return new AnthropicToolCall(
                    AnthropicCallStatus.Unavailable, null, (int)response.StatusCode, ReadString(reply, "error", "type"),
                    ErrorHint: Classify(ReadString(reply, "error", "message")));
            }

            return new AnthropicToolCall(AnthropicCallStatus.Ok, FirstToolInput(reply), StopReason: ReadString(reply, "stop_reason"));
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            return new AnthropicToolCall(AnthropicCallStatus.Timeout, null);
        }
        catch (HttpRequestException)
        {
            return new AnthropicToolCall(AnthropicCallStatus.Unavailable, null);
        }
    }

    /// <summary>Reduces an error message to a hint; the text is dropped right here.</summary>
    internal static AnthropicErrorHint Classify(string? message) =>
        message is not null && message.Contains("credit balance", StringComparison.OrdinalIgnoreCase)
            ? AnthropicErrorHint.CreditBalance
            : AnthropicErrorHint.None;

    private static string? ReadString(string json, params string[] path)
    {
        try
        {
            using var parsed = JsonDocument.Parse(json);
            var node = parsed.RootElement;
            foreach (var name in path)
            {
                if (node.ValueKind != JsonValueKind.Object || !node.TryGetProperty(name, out node))
                    return null;
            }

            return node.ValueKind == JsonValueKind.String ? node.GetString() : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static JsonDocument? FirstToolInput(string reply)
    {
        try
        {
            using var parsed = JsonDocument.Parse(reply);
            if (parsed.RootElement.ValueKind != JsonValueKind.Object
                || !parsed.RootElement.TryGetProperty("content", out var content)
                || content.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            foreach (var block in content.EnumerateArray())
            {
                if (block.ValueKind == JsonValueKind.Object
                    && block.TryGetProperty("type", out var type) && type.ValueEquals("tool_use")
                    && block.TryGetProperty("input", out var input))
                {
                    return JsonDocument.Parse(input.GetRawText());
                }
            }

            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
