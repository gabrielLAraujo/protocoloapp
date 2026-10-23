namespace ProtocoloApp.Api.Features.Updates;

public static class UpdatesSetup
{
    /// <summary>Maps the update cycle endpoints on the protected <c>/api</c> group.</summary>
    public static void MapUpdates(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        api.MapUpdateEndpoints();
    }
}
