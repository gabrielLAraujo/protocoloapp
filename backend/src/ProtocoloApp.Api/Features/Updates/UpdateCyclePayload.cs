using FluentValidation;
using ProtocoloApp.Api.Features.Plans;

namespace ProtocoloApp.Api.Features.Updates;

/// <summary>
/// <c>update_cycle</c>: <c>{protocol_version_id, period_start, period_end, status, answers, photos, sent_at}</c>.
/// <c>protocol_version_id</c>, <c>period_start</c> and <c>period_end</c> belong to the server: pull sends them, push ignores
/// them. <c>status</c> is <c>collecting|draft|sent</c>; <c>answers</c> is an object <c>key -> text</c> (at most 300 keys of
/// <c>^[a-z0-9_]{1,64}$</c>, texts up to 4000); <c>photos</c> is <c>[{pose, file_id, taken_at}]</c> (at most 40, one per pose).
/// </summary>
public sealed record UpdateCyclePayload
{
    public Guid? ProtocolVersionId { get; init; }

    public DateOnly? PeriodStart { get; init; }

    public DateOnly? PeriodEnd { get; init; }

    public string? Status { get; init; }

    public IReadOnlyDictionary<string, string?>? Answers { get; init; }

    public IReadOnlyList<UpdateCyclePhotoDto?>? Photos { get; init; }

    public DateTimeOffset? SentAt { get; init; }
}

/// <summary>One photo of the cycle: the pose key, the confirmed <c>photo</c> file and when it was taken.</summary>
public sealed record UpdateCyclePhotoDto
{
    public string? Pose { get; init; }

    public Guid? FileId { get; init; }

    public DateTimeOffset? TakenAt { get; init; }
}

public sealed class UpdateCyclePayloadValidator : AbstractValidator<UpdateCyclePayload>
{
    public const int MaxAnswers = 300;
    public const int MaxPhotos = 40;

    private static readonly IReadOnlyList<string> Statuses = EnumText.Values<UpdateCycleStatus>();

    public UpdateCyclePayloadValidator()
    {
        RuleFor(p => p.Status).Must(s => s is not null && Statuses.Contains(s, StringComparer.Ordinal)).OverridePropertyName("status");
        RuleFor(p => p.Answers).Must(BeValidAnswers).OverridePropertyName("answers");
        RuleFor(p => p.Photos).Must(BeValidPhotos).OverridePropertyName("photos");
    }

    private static bool BeValidAnswers(IReadOnlyDictionary<string, string?>? answers) =>
        answers is null
        || (answers.Count <= MaxAnswers
            && answers.All(a => QuestionnaireRules.QuestionKey().IsMatch(a.Key) && a.Value is not null && a.Value.Length <= QuestionnaireRules.MaxAnswerLength));

    private static bool BeValidPhotos(IReadOnlyList<UpdateCyclePhotoDto?>? photos)
    {
        if (photos is null)
            return true;
        if (photos.Count > MaxPhotos)
            return false;

        var poses = new HashSet<string>(StringComparer.Ordinal);
        foreach (var photo in photos)
        {
            if (photo?.Pose is null || !QuestionnaireRules.PoseKey().IsMatch(photo.Pose) || !poses.Add(photo.Pose))
                return false;
            if (photo.FileId is null || photo.FileId == Guid.Empty || photo.TakenAt is null)
                return false;
        }

        return true;
    }
}
