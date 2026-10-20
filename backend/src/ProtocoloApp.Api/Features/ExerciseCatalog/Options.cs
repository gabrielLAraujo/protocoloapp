namespace ProtocoloApp.Api.Features.ExerciseCatalog;

public sealed class ExerciseCatalogOptions
{
    public const string Section = "ExerciseCatalog";

    /// <summary>Off keeps the sync from running (tests, or an install that does not want to reach ExerciseDB).</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>The catalog is downloaded again at start when the last complete sync is older than this.</summary>
    public int RefreshAfterDays { get; set; } = 30;

    /// <summary>Pause between pages, to stay polite with the free API.</summary>
    public int PageDelayMilliseconds { get; set; } = 1200;
}
