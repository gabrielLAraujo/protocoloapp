namespace ProtocoloApp.Api.Features.ExerciseCatalog;

/// <summary>
/// An exercise of the public ExerciseDB catalog, mirrored on the server (shared by every user, not a sync entity).
/// Only what the app shows is kept: no instructions.
/// </summary>
public sealed class CatalogExercise
{
    public const int MaxIdLength = 100;
    public const int MaxNameLength = 200;
    public const int MaxGifUrlLength = 500;
    public const int MaxTags = 20;
    public const int MaxTagLength = 100;

    /// <summary>ExerciseDB's <c>exerciseId</c>.</summary>
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public string[] BodyParts { get; set; } = [];

    public string[] TargetMuscles { get; set; } = [];

    public string[] SecondaryMuscles { get; set; } = [];

    public string[] Equipments { get; set; } = [];

    /// <summary>Only ever an <c>https://static.exercisedb.dev/</c> URL; null when the source gave none or another host.</summary>
    public string? GifUrl { get; set; }

    public DateTimeOffset SyncedAt { get; set; }
}
