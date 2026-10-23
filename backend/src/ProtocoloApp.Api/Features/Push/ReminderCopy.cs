using ProtocoloApp.Api.Features.Today;

namespace ProtocoloApp.Api.Features.Push;

/// <summary>
/// The text of a reminder. Only generic labels: never a dose, a compound or hormone name, nor any protocol item name
/// (a notification shows on the lock screen).
/// </summary>
public static class ReminderCopy
{
    public const string Title = "Protocolo";
    public const string TodayUrl = "/hoje";

    private const string MealPrefix = "meal_";

    public static PushMessage For(string slotKey, TimeOnly time, string? mealLabel) =>
        new(Title, Body(slotKey, time, mealLabel), TodayUrl, slotKey);

    public const string UpdateUrl = "/atualizacao";

    /// <summary>The photos reminder for the update date <paramref name="daysLeft"/> days away (0 = today).</summary>
    public static PushMessage Update(int daysLeft)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(daysLeft);
        var body = daysLeft switch
        {
            0 => "Atualização hoje: hora das fotos",
            1 => "Atualização amanhã: hora das fotos",
            _ => $"Atualização em {daysLeft} dias: hora das fotos",
        };
        return new PushMessage(Title, body, UpdateUrl, ReminderScheduler.UpdatePhotosSlot);
    }

    public static string Body(string slotKey, TimeOnly time, string? mealLabel)
    {
        ArgumentNullException.ThrowIfNull(slotKey);

        if (slotKey.StartsWith(MealPrefix, StringComparison.Ordinal))
            return $"{(string.IsNullOrWhiteSpace(mealLabel) ? "Refeição" : mealLabel)} — {time:HH:mm}";

        return slotKey switch
        {
            "fasting" => "Itens em jejum",
            "after_meal" => "Itens após a refeição",
            "before_bed" => "Itens antes de dormir",
            "pre_workout" => "Itens pré-treino",
            "intra_workout" => "Itens durante o treino",
            "post_workout" => "Itens pós-treino",
            DayPlanner.CardioKey => "Hora do cardio",
            DayPlanner.WorkoutKey => "Hora do treino",
            DayPlanner.CheckinMorningSlot => "Check-in da manhã",
            DayPlanner.CheckinEveningSlot => "Check-in da noite",
            _ => "Hora do lembrete",
        };
    }
}
