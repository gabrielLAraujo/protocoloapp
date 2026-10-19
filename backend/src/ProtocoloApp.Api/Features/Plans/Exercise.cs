using ProtocoloApp.Api.Shared.Data;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>An exercise of the user's catalog. Created by the server only (plan activation); clients receive it by pull.</summary>
public sealed class Exercise : ISyncEntity
{
    public const int MaxNameLength = 200;

    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public long Version { get; set; }

    public DateTimeOffset ClientUpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public string Name { get; set; } = "";

    /// <summary><see cref="ExerciseNames.Normalize"/> of <see cref="Name"/>; unique per user.</summary>
    public string NormalizedName { get; set; } = "";

    public MuscleGroup PrimaryMuscleGroup { get; set; } = MuscleGroup.Other;

    public string[] Aliases { get; set; } = [];
}
