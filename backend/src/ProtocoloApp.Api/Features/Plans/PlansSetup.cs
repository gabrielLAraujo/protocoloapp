namespace ProtocoloApp.Api.Features.Plans;

public static class PlansSetup
{
    /// <summary>Maps the plan and exercise endpoints on the protected <c>/api</c> group.</summary>
    public static void MapPlans(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);

        api.MapPlanEndpoints();
        api.MapExerciseEndpoints();
    }
}
