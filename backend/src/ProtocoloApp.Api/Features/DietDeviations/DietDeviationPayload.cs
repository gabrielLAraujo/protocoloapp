using FluentValidation;
using ProtocoloApp.Api.Features.Today;

namespace ProtocoloApp.Api.Features.DietDeviations;

/// <summary>
/// <c>diet_deviation</c>: <c>{date, meal_key?, time?, description, quantity?}</c>; <c>meal_key</c> null is a meal outside the
/// plan, <c>time</c> is <c>HH:mm</c>, <c>description</c> is required (1–200 characters, not blank), <c>quantity</c> up to 60.
/// </summary>
public sealed record DietDeviationPayload
{
    public DateOnly? Date { get; init; }

    public string? MealKey { get; init; }

    public string? Time { get; init; }

    public string? Description { get; init; }

    public string? Quantity { get; init; }
}

public sealed class DietDeviationPayloadValidator : AbstractValidator<DietDeviationPayload>
{
    public DietDeviationPayloadValidator()
    {
        RuleFor(p => p.Date).NotNull().OverridePropertyName("date");
        RuleFor(p => p.MealKey).Must(k => k is null || TodayPatterns.Key().IsMatch(k)).OverridePropertyName("meal_key");
        RuleFor(p => p.Time).Must(t => t is null || TodayPatterns.Time().IsMatch(t)).OverridePropertyName("time");
        RuleFor(p => p.Description)
            .Must(d => !string.IsNullOrWhiteSpace(d) && d.Length <= DietDeviation.MaxDescriptionLength)
            .OverridePropertyName("description");
        RuleFor(p => p.Quantity).MaximumLength(DietDeviation.MaxQuantityLength).OverridePropertyName("quantity");
    }
}
