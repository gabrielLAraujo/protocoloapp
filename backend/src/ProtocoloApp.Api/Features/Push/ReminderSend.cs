namespace ProtocoloApp.Api.Features.Push;

/// <summary>
/// Claims the reminder of one slot on one local date for one user. Inserted before the push is sent; the unique
/// (user, date, slot) index makes a second server, a restart or a late tick find it taken.
/// </summary>
public sealed class ReminderSend
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    /// <summary>Local date (America/Sao_Paulo).</summary>
    public DateOnly Date { get; set; }

    public string Slot { get; set; } = "";

    public DateTimeOffset SentAt { get; set; }
}
