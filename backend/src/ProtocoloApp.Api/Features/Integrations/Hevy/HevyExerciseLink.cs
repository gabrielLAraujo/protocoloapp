namespace ProtocoloApp.Api.Features.Integrations.Hevy;

public enum HevyLinkStatus
{
    /// <summary>Matched by the server.</summary>
    Auto,

    /// <summary>No sure match: waits for the user's confirmation.</summary>
    Pending,

    /// <summary>Chosen by the user.</summary>
    Confirmed,
}

/// <summary>Links a Hevy exercise template to one of the user's exercises. Not synchronized (REST only).</summary>
public sealed class HevyExerciseLink
{
    public const int MaxTemplateIdLength = 64;
    public const int MaxTitleLength = 200;

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    /// <summary>Hevy's <c>exercise_template_id</c>.</summary>
    public string TemplateId { get; set; } = "";

    /// <summary>The exercise title last seen in Hevy.</summary>
    public string Title { get; set; } = "";

    public Guid ExerciseId { get; set; }

    public HevyLinkStatus Status { get; set; }

    /// <summary>Whether the exercise was created by the import (the provisional one).</summary>
    public bool CreatedExercise { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}
