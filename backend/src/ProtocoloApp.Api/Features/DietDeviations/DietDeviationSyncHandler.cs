using System.Globalization;
using FluentValidation;
using ProtocoloApp.Api.Features.Sync;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.DietDeviations;

/// <summary>Syncs <see cref="DietDeviation"/> as <c>diet_deviation</c>. No natural key: the client id is the identity.</summary>
public sealed class DietDeviationSyncHandler(AppDbContext db, TimeProvider clock)
    : SyncHandler<DietDeviation, DietDeviationPayload>(db, clock)
{
    public const string EntityName = "diet_deviation";

    private const string TimeFormat = "HH':'mm";

    private static readonly DietDeviationPayloadValidator PayloadValidator = new();

    public override string Entity => EntityName;

    protected override IValidator<DietDeviationPayload> Validator => PayloadValidator;

    protected override DietDeviation Create(Guid id, Guid userId) => new() { Id = id, UserId = userId };

    protected override void Apply(DietDeviationPayload payload, DietDeviation entity)
    {
        entity.Date = payload.Date!.Value;
        entity.MealKey = payload.MealKey;
        // The validator already guarantees HH:mm; TryParse keeps a bad value from ever becoming a 500.
        entity.Time = payload.Time is not null
            && TimeOnly.TryParseExact(payload.Time, TimeFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)
                ? time
                : null;
        entity.Description = payload.Description!;
        entity.Quantity = string.IsNullOrWhiteSpace(payload.Quantity) ? null : payload.Quantity;
    }

    protected override DietDeviationPayload CreatePayload(DietDeviation entity) => new()
    {
        Date = entity.Date,
        MealKey = entity.MealKey,
        Time = entity.Time?.ToString(TimeFormat, CultureInfo.InvariantCulture),
        Description = entity.Description,
        Quantity = entity.Quantity,
    };
}
