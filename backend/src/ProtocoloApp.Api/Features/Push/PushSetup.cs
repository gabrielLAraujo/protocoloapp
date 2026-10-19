using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ProtocoloApp.Api.Features.Push;

public static class PushSetup
{
    /// <summary>
    /// Web Push sender and the reminder loop. <c>Reminders:Enabled=false</c> keeps the loop from running (tests);
    /// <c>Push:Subject</c> is the VAPID contact.
    /// </summary>
    public static IServiceCollection AddPush(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<PushOptions>(configuration.GetSection(PushOptions.Section));
        services.Configure<RemindersOptions>(configuration.GetSection(RemindersOptions.Section));
        services.TryAddSingleton(TimeProvider.System);
        services.AddSingleton<IZoneProvider, SaoPauloZoneProvider>();
        services.AddSingleton<VapidProvider>();
        services.AddHttpClient<IPushSender, WebPushSender>(client => client.Timeout = TimeSpan.FromSeconds(20));
        services.AddSingleton<ReminderScheduler>();
        services.AddHostedService(sp => sp.GetRequiredService<ReminderScheduler>());
        return services;
    }

}
