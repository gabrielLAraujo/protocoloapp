using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;
using ProtocoloApp.Api.Features.ExerciseCatalog;

namespace ProtocoloApp.UnitTests.ExerciseCatalog;

public sealed class ExerciseDbClientTests
{
    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<Uri> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request.RequestUri!);
            return Task.FromResult(respond(request));
        }
    }

    private static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static (ExerciseDbClient Client, FakeHandler Handler) Create(Func<HttpRequestMessage, HttpResponseMessage> respond)
    {
        var handler = new FakeHandler(respond);
        var http = new HttpClient(handler) { BaseAddress = ExerciseDbClient.BaseAddress };
        return (new ExerciseDbClient(http, NullLogger<ExerciseDbClient>.Instance), handler);
    }

    private const string Page = """
        {"success":true,"meta":{"total":2,"hasNextPage":true,"nextCursor":"abc=="},
         "data":[
           {"exerciseId":"ex_1","name":"cable curl","gifUrl":"https://static.exercisedb.dev/media/ex_1.gif",
            "bodyParts":["upper arms"],"equipments":["cable"],"targetMuscles":["biceps"],"secondaryMuscles":["forearms"],"instructions":["x"]},
           {"exerciseId":"ex_2","name":"fake gif","gifUrl":"https://evil.example/ex_2.gif",
            "bodyParts":[],"equipments":[],"targetMuscles":[],"secondaryMuscles":[]},
           {"name":"no id"},
           {"exerciseId":"ex_3"}
         ]}
        """;

    [Fact]
    public async Task First_page_requests_limit_25_on_the_exercisedb_host_without_cursor()
    {
        var (client, handler) = Create(_ => Json(Page));

        await client.GetPageAsync(null, CancellationToken.None);

        var uri = Assert.Single(handler.Requests);
        Assert.Equal("https://oss.exercisedb.dev/api/v1/exercises?limit=25", uri.ToString());
    }

    [Fact]
    public async Task Next_pages_send_the_escaped_after_cursor()
    {
        var (client, handler) = Create(_ => Json(Page));

        await client.GetPageAsync("a+b/c==", CancellationToken.None);

        Assert.Equal("https://oss.exercisedb.dev/api/v1/exercises?limit=25&after=a%2Bb%2Fc%3D%3D", Assert.Single(handler.Requests).ToString());
    }

    [Fact]
    public async Task Parses_items_meta_and_drops_items_without_id_or_name()
    {
        var (client, _) = Create(_ => Json(Page));

        var page = await client.GetPageAsync(null, CancellationToken.None);

        Assert.NotNull(page);
        Assert.True(page.HasNextPage);
        Assert.Equal("abc==", page.NextCursor);
        Assert.Equal(["ex_1", "ex_2"], page.Items.Select(i => i.Id));
        var first = page.Items[0];
        Assert.Equal("cable curl", first.Name);
        Assert.Equal(["upper arms"], first.BodyParts);
        Assert.Equal(["biceps"], first.TargetMuscles);
        Assert.Equal(["forearms"], first.SecondaryMuscles);
        Assert.Equal(["cable"], first.Equipments);
        Assert.Equal("https://static.exercisedb.dev/media/ex_1.gif", first.GifUrl);
    }

    [Fact]
    public async Task A_gif_url_outside_the_static_host_is_dropped()
    {
        var (client, _) = Create(_ => Json(Page));

        var page = await client.GetPageAsync(null, CancellationToken.None);

        Assert.Null(page!.Items[1].GifUrl);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.Found)]
    public async Task A_failed_status_returns_null(HttpStatusCode status)
    {
        var (client, _) = Create(_ => Json("{}", status));

        Assert.Null(await client.GetPageAsync(null, CancellationToken.None));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("""{"success":true}""")]
    [InlineData("""{"data":{"a":1}}""")]
    public async Task An_unexpected_format_returns_null(string body)
    {
        var (client, _) = Create(_ => Json(body));

        Assert.Null(await client.GetPageAsync(null, CancellationToken.None));
    }

    [Fact]
    public async Task A_network_error_returns_null()
    {
        var (client, _) = Create(_ => throw new HttpRequestException("boom"));

        Assert.Null(await client.GetPageAsync(null, CancellationToken.None));
    }

    [Fact]
    public async Task Missing_meta_means_no_next_page()
    {
        var (client, _) = Create(_ => Json("""{"data":[{"exerciseId":"a","name":"A"}]}"""));

        var page = await client.GetPageAsync(null, CancellationToken.None);

        Assert.False(page!.HasNextPage);
        Assert.Null(page.NextCursor);
        Assert.Single(page.Items);
    }
}
