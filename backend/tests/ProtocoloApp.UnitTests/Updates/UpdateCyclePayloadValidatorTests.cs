using ProtocoloApp.Api.Features.Updates;

namespace ProtocoloApp.UnitTests.Updates;

public sealed class UpdateCyclePayloadValidatorTests
{
    private static readonly UpdateCyclePayloadValidator Validator = new();

    private static readonly DateTimeOffset TakenAt = new(2026, 3, 10, 12, 0, 0, TimeSpan.Zero);

    private static readonly UpdateCyclePayload Valid = new()
    {
        Status = "draft",
        Answers = new Dictionary<string, string?> { ["week_summary"] = "Semana de exemplo.", ["missed_training"] = "1" },
        Photos =
        [
            new UpdateCyclePhotoDto { Pose = "front", FileId = Guid.NewGuid(), TakenAt = TakenAt },
            new UpdateCyclePhotoDto { Pose = "back", FileId = Guid.NewGuid(), TakenAt = TakenAt },
        ],
    };

    private static List<string> Errors(UpdateCyclePayload payload) =>
        Validator.Validate(payload).Errors.Select(e => e.PropertyName).Distinct().ToList();

    [Fact]
    public void Valid_payload_passes()
    {
        Assert.Empty(Errors(Valid));
    }

    [Fact]
    public void Server_fields_are_not_required()
    {
        Assert.Null(Valid.ProtocolVersionId);
        Assert.Empty(Errors(Valid with { Status = "collecting", Answers = new Dictionary<string, string?>(), Photos = [] }));
        Assert.Empty(Errors(Valid with { Status = "sent", SentAt = TakenAt }));
    }

    [Theory]
    [InlineData("done")]
    [InlineData("Sent")]
    [InlineData(null)]
    public void Unknown_status_is_an_error(string? status)
    {
        Assert.Equal(["status"], Errors(Valid with { Status = status }));
    }

    [Fact]
    public void A_malformed_answer_key_is_an_error()
    {
        Assert.Equal(["answers"], Errors(Valid with { Answers = new Dictionary<string, string?> { ["A b"] = "Texto." } }));
    }

    [Fact]
    public void An_answer_over_4000_characters_is_an_error()
    {
        Assert.Empty(Errors(Valid with { Answers = new Dictionary<string, string?> { ["long"] = new string('a', 4000) } }));
        Assert.Equal(["answers"], Errors(Valid with { Answers = new Dictionary<string, string?> { ["long"] = new string('a', 4001) } }));
    }

    [Fact]
    public void More_than_300_answers_is_an_error()
    {
        var answers = Enumerable.Range(0, 301).ToDictionary(i => $"q_{i}", _ => (string?)"x");

        Assert.Equal(["answers"], Errors(Valid with { Answers = answers }));
    }

    [Fact]
    public void Two_photos_of_the_same_pose_is_an_error()
    {
        var photos = new List<UpdateCyclePhotoDto>
        {
            new() { Pose = "front", FileId = Guid.NewGuid(), TakenAt = TakenAt },
            new() { Pose = "front", FileId = Guid.NewGuid(), TakenAt = TakenAt },
        };

        Assert.Equal(["photos"], Errors(Valid with { Photos = photos }));
    }

    [Fact]
    public void A_photo_without_file_or_with_a_bad_pose_is_an_error()
    {
        Assert.Equal(["photos"], Errors(Valid with { Photos = [new UpdateCyclePhotoDto { Pose = "front", TakenAt = TakenAt }] }));
        Assert.Equal(["photos"], Errors(Valid with { Photos = [new UpdateCyclePhotoDto { Pose = "Frente", FileId = Guid.NewGuid(), TakenAt = TakenAt }] }));
        Assert.Equal(["photos"], Errors(Valid with { Photos = [new UpdateCyclePhotoDto { Pose = "front", FileId = Guid.NewGuid() }] }));
    }

    [Fact]
    public void More_than_40_photos_is_an_error()
    {
        var photos = Enumerable.Range(0, 41)
            .Select(i => new UpdateCyclePhotoDto { Pose = $"pose_{i}", FileId = Guid.NewGuid(), TakenAt = TakenAt })
            .ToList();

        Assert.Equal(["photos"], Errors(Valid with { Photos = photos }));
    }
}
