using Microsoft.AspNetCore.Http.Metadata;

namespace ProtocoloApp.Api.Shared.Http;

/// <summary>
/// Enforces an endpoint's <see cref="IRequestSizeLimitMetadata"/> on every server, the test host included: a declared
/// <c>Content-Length</c> above the limit is a 413 right away, and a body that reads past it (chunked) fails with a 413 too.
/// Kestrel also applies the same metadata itself; this keeps the behaviour where the server does not.
/// </summary>
public static class BodySizeLimitSetup
{
    public static IApplicationBuilder UseEndpointBodySizeLimit(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        return app.Use(async (context, next) =>
        {
            if (context.GetEndpoint()?.Metadata.GetMetadata<IRequestSizeLimitMetadata>() is { MaxRequestBodySize: { } max })
            {
                if (context.Request.ContentLength > max)
                {
                    // Empty body: the status code pages write the problem details.
                    context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
                    return;
                }

                context.Request.Body = new LimitedReadStream(context.Request.Body, max);
            }

            await next(context);
        });
    }

    /// <summary>Reads through to the inner stream and throws a 413 <see cref="BadHttpRequestException"/> once past the limit.</summary>
    private sealed class LimitedReadStream(Stream inner, long limit) : Stream
    {
        private long _read;

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => throw new NotSupportedException();

        public override long Position
        {
            get => _read;
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count) => Count(inner.Read(buffer, offset, count));

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
            Count(await inner.ReadAsync(buffer, cancellationToken));

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        private int Count(int read)
        {
            _read += read;
            if (_read > limit)
                throw new BadHttpRequestException("Corpo da requisição grande demais.", StatusCodes.Status413PayloadTooLarge);
            return read;
        }
    }
}
