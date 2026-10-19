using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using ProtocoloApp.Api.Features.Today;
using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Push;

/// <summary>Table <c>app_secrets</c>.</summary>
public sealed class AppSecretConfiguration : IEntityTypeConfiguration<AppSecret>
{
    public void Configure(EntityTypeBuilder<AppSecret> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.HasKey(s => s.Name);
        builder.Property(s => s.Name).HasMaxLength(AppSecret.MaxNameLength);
    }
}

/// <summary>Table <c>push_subscriptions</c>.</summary>
public sealed class PushSubscriptionConfiguration : IEntityTypeConfiguration<PushSubscription>
{
    public void Configure(EntityTypeBuilder<PushSubscription> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.HasKey(s => s.Id);
        builder.Property(s => s.Id).ValueGeneratedNever();
        builder.Property(s => s.Endpoint).HasMaxLength(PushSubscription.MaxEndpointLength);
        builder.Property(s => s.P256dh).HasMaxLength(PushSubscription.MaxKeyLength);
        builder.Property(s => s.Auth).HasMaxLength(PushSubscription.MaxKeyLength);
        builder.Property(s => s.UserAgent).HasMaxLength(PushSubscription.MaxUserAgentLength);

        builder.HasIndex(s => s.Endpoint).IsUnique();
        builder.HasIndex(s => s.UserId);

        builder.HasOne<AppUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

/// <summary>Table <c>reminder_sends</c>: unique per user, date and slot.</summary>
public sealed class ReminderSendConfiguration : IEntityTypeConfiguration<ReminderSend>
{
    public void Configure(EntityTypeBuilder<ReminderSend> builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.HasKey(r => r.Id);
        builder.Property(r => r.Id).ValueGeneratedNever();
        builder.Property(r => r.Slot).HasMaxLength(ScheduleSlot.MaxSlotLength);

        builder.HasIndex(r => new { r.UserId, r.Date, r.Slot }).IsUnique();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
