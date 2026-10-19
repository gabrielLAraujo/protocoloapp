namespace ProtocoloApp.Api.Features.Push;

/// <summary>The time zone of "today" and of reminder times. Behind an interface so tests can pick their own.</summary>
public interface IZoneProvider
{
    TimeZoneInfo Zone { get; }
}

/// <summary>America/Sao_Paulo (needs tzdata, present in the aspnet image and on the CI runners).</summary>
public sealed class SaoPauloZoneProvider : IZoneProvider
{
    public const string ZoneId = "America/Sao_Paulo";

    public TimeZoneInfo Zone { get; } = TimeZoneInfo.FindSystemTimeZoneById(ZoneId);
}
