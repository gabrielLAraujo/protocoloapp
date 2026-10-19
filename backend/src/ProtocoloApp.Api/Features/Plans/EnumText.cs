using System.Text;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace ProtocoloApp.Api.Features.Plans;

/// <summary>Enums as lowercase snake_case text (<c>LowerBack</c> becomes <c>lower_back</c>), in the database and in sync payloads.</summary>
public static class EnumText
{
    public static string ToText<TEnum>(TEnum value) where TEnum : struct, Enum => ToSnake(value.ToString());

    /// <exception cref="FormatException">Not one of the enum's values.</exception>
    public static TEnum Parse<TEnum>(string text) where TEnum : struct, Enum
    {
        foreach (var value in Enum.GetValues<TEnum>())
        {
            if (ToText(value) == text)
                return value;
        }

        throw new FormatException($"Unknown {typeof(TEnum).Name} value '{text}'.");
    }

    public static IReadOnlyList<string> Values<TEnum>() where TEnum : struct, Enum => Enum.GetValues<TEnum>().Select(ToText).ToList();

    public static ValueConverter<TEnum, string> Converter<TEnum>() where TEnum : struct, Enum =>
        new(v => ToText(v), v => Parse<TEnum>(v));

    /// <summary><c>('a', 'b')</c> for a check constraint.</summary>
    public static string SqlList<TEnum>() where TEnum : struct, Enum => "(" + string.Join(", ", Values<TEnum>().Select(v => $"'{v}'")) + ")";

    private static string ToSnake(string name)
    {
        var builder = new StringBuilder(name.Length + 4);
        for (var i = 0; i < name.Length; i++)
        {
            if (char.IsUpper(name[i]) && i > 0)
                builder.Append('_');
            builder.Append(char.ToLowerInvariant(name[i]));
        }

        return builder.ToString();
    }
}
