using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ProtocoloApp.Api.Features.Integrations.Secrets;

namespace ProtocoloApp.UnitTests.Integrations;

public sealed class AesGcmSecretProtectorTests
{
    private const string Purpose = "hevy:00000000-0000-0000-0000-000000000001";

    private static string NewKey() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    private static AesGcmSecretProtector Create(string? key, ILogger<AesGcmSecretProtector>? logger = null) =>
        new(Options.Create(new IntegrationsOptions { EncryptionKey = key }),
            logger ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<AesGcmSecretProtector>.Instance);

    [Fact]
    public void Roundtrip()
    {
        var p = Create(NewKey());
        Assert.True(p.IsConfigured);
        var data = p.Protect("test-key-0000-0000-0000-000000000001", Purpose);
        Assert.True(p.TryUnprotect(data, Purpose, out var text));
        Assert.Equal("test-key-0000-0000-0000-000000000001", text);
        Assert.Equal(1, data[0]);
    }

    [Fact]
    public void NewNonceEveryCall()
    {
        var p = Create(NewKey());
        Assert.NotEqual(p.Protect("x", Purpose), p.Protect("x", Purpose));
    }

    [Fact]
    public void OtherPurposeFails()
    {
        var p = Create(NewKey());
        var data = p.Protect("x", Purpose);
        Assert.False(p.TryUnprotect(data, "hevy:other", out var text));
        Assert.Equal("", text);
    }

    [Fact]
    public void TamperedTagFails()
    {
        var p = Create(NewKey());
        var data = p.Protect("x", Purpose);
        data[^1] ^= 0x01;
        Assert.False(p.TryUnprotect(data, Purpose, out _));
    }

    [Fact]
    public void OtherKeyFails()
    {
        var data = Create(NewKey()).Protect("x", Purpose);
        Assert.False(Create(NewKey()).TryUnprotect(data, Purpose, out _));
    }

    [Fact]
    public void WrongVersionFails()
    {
        var p = Create(NewKey());
        var data = p.Protect("x", Purpose);
        data[0] = 2;
        Assert.False(p.TryUnprotect(data, Purpose, out _));
    }

    [Fact]
    public void TooShortFails()
    {
        var p = Create(NewKey());
        Assert.False(p.TryUnprotect([1, 2, 3], Purpose, out _));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not base64 !!")]
    public void InvalidKeyIsNotConfigured(string? key)
    {
        var p = Create(key);
        Assert.False(p.IsConfigured);
        Assert.Throws<InvalidOperationException>(() => p.Protect("x", Purpose));
        Assert.False(p.TryUnprotect(new byte[40], Purpose, out _));
    }

    [Fact]
    public void ShortKeyIsNotConfigured()
    {
        Assert.False(Create(Convert.ToBase64String(RandomNumberGenerator.GetBytes(16))).IsConfigured);
    }

    [Fact]
    public void WarningDoesNotContainKey()
    {
        var shortKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        var logger = new CapturingLogger();
        Create(shortKey, logger);
        var entry = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Warning, entry.Level);
        Assert.DoesNotContain(shortKey, entry.Message);
    }

    private sealed class CapturingLogger : ILogger<AesGcmSecretProtector>
    {
        public List<(LogLevel Level, string Message)> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Entries.Add((logLevel, formatter(state, exception)));
    }
}
