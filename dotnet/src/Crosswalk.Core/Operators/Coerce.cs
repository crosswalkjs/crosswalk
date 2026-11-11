using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Crosswalk.Operators;

/// <summary>
/// Reads operator inputs the way the built-in operators do. The rules are part of
/// the map format: see the conformance suite's README.
/// </summary>
public static partial class Coerce
{
    // A plain decimal number. Only ASCII digits: .NET's \d would also match other scripts' digits.
    [GeneratedRegex("^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+)?$")]
    private static partial Regex Decimal();

    private static readonly JsonSerializerOptions Compact = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>The number in a JSON number value, or null if it isn't one.</summary>
    internal static double? NumberIn(JsonNode? node)
    {
        if (node is not JsonValue value || value.GetValueKind() != JsonValueKind.Number) return null;
        if (value.TryGetValue<double>(out var d)) return d;
        if (value.TryGetValue<long>(out var l)) return l;
        if (value.TryGetValue<int>(out var i)) return i;
        if (value.TryGetValue<decimal>(out var m)) return (double)m;
        if (value.TryGetValue<float>(out var f)) return f;
        return double.Parse(value.ToJsonString(), CultureInfo.InvariantCulture);
    }

    private static string? TextIn(JsonNode? node) =>
        node is JsonValue value && value.GetValueKind() == JsonValueKind.String ? value.GetValue<string>() : null;

    private static bool? BooleanIn(JsonNode? node) =>
        node is JsonValue value && value.GetValueKind() is JsonValueKind.True or JsonValueKind.False ? value.GetValue<bool>() : null;

    private static string Describe(Value value) =>
        value.IsAbsent ? "nothing" : TextIn(value.Node) is { } text ? $"\"{text}\"" : value.IsNull ? "null" : value.Node!.ToJsonString(Compact);

    /// <summary>Reads a value as text. <c>null</c> and absent read as empty text, and numbers as JavaScript writes them.</summary>
    public static string ToText(Value value)
    {
        if (value.IsAbsent || value.IsNull) return "";
        var node = value.Node!;
        if (TextIn(node) is { } text) return text;
        if (NumberIn(node) is { } number) return NumberToText(number);
        if (BooleanIn(node) is { } boolean) return boolean ? "true" : "false";
        return node.ToJsonString(Compact);
    }

    /// <summary>True for a JSON number, or text holding a plain decimal number (surrounding spaces allowed).</summary>
    public static bool IsNumeric(Value value)
    {
        if (value.IsAbsent) return false;
        if (NumberIn(value.Node) is { } number) return double.IsFinite(number);
        return TextIn(value.Node) is { } text && ParseDecimal(text) is not null;
    }

    private static double? ParseDecimal(string text)
    {
        var trimmed = text.Trim();
        if (!Decimal().IsMatch(trimmed)) return null;
        return double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) && double.IsFinite(d) ? d : null;
    }

    /// <summary>Reads a value as a number: a number, numeric text, or a boolean as 1 or 0. Anything else throws an <see cref="OperatorException"/>.</summary>
    public static double ToNumber(Value value)
    {
        if (!value.IsAbsent)
        {
            if (NumberIn(value.Node) is { } number) return number;
            if (TextIn(value.Node) is { } text && ParseDecimal(text) is { } parsed) return parsed;
            if (BooleanIn(value.Node) is { } boolean) return boolean ? 1 : 0;
        }
        throw new OperatorException($"Expected a number but got {Describe(value)}");
    }

    /// <summary>Reads a value as true or false: a boolean, the text <c>"true"</c> or <c>"false"</c>, or a number (non-zero is true).</summary>
    public static bool ToBoolean(Value value)
    {
        if (!value.IsAbsent)
        {
            if (BooleanIn(value.Node) is { } boolean) return boolean;
            if (TextIn(value.Node) is "true") return true;
            if (TextIn(value.Node) is "false") return false;
            if (NumberIn(value.Node) is { } number) return number != 0;
        }
        throw new OperatorException($"Expected true or false but got {Describe(value)}");
    }

    /// <summary>Compares two values: as numbers when both are numeric, otherwise as text by UTF-16 code unit.</summary>
    public static int Compare(Value a, Value b)
    {
        if (IsNumeric(a) && IsNumeric(b)) return ToNumber(a).CompareTo(ToNumber(b));
        return Math.Sign(string.CompareOrdinal(ToText(a), ToText(b)));
    }

    /// <summary>
    /// Writes a number as JavaScript's <c>String(n)</c> does: the shortest digits that read
    /// back as the same number, plainly from 1e-6 up to 1e21 and with an exponent outside that.
    /// </summary>
    public static string NumberToText(double number)
    {
        if (double.IsNaN(number)) return "NaN";
        if (double.IsInfinity(number)) return number > 0 ? "Infinity" : "-Infinity";
        if (number == 0) return "0";

        // .NET's "R" gives the shortest round-trip digits; only the layout differs from JavaScript.
        var shortest = Math.Abs(number).ToString("R", CultureInfo.InvariantCulture);
        var exponentAt = shortest.IndexOfAny(['E', 'e']);
        var mantissa = exponentAt < 0 ? shortest : shortest[..exponentAt];
        var exponent = exponentAt < 0 ? 0 : int.Parse(shortest[(exponentAt + 1)..], CultureInfo.InvariantCulture);
        var point = mantissa.IndexOf('.');
        var digits = (point < 0 ? mantissa : mantissa.Remove(point, 1)).TrimStart('0');
        var leadingZeros = (point < 0 ? mantissa : mantissa.Remove(point, 1)).Length - digits.Length;
        digits = digits.TrimEnd('0');
        if (digits.Length == 0) return "0";
        // n: the value is 0.<digits> × 10^n, in the terms of ECMAScript's Number::toString.
        var n = (point < 0 ? mantissa.Length : point) - leadingZeros + exponent;
        var k = digits.Length;

        var text = new StringBuilder(number < 0 ? "-" : "");
        if (k <= n && n <= 21) text.Append(digits).Append('0', n - k);
        else if (0 < n && n <= 21) text.Append(digits, 0, n).Append('.').Append(digits, n, k - n);
        else if (-6 < n && n <= 0) text.Append("0.").Append('0', -n).Append(digits);
        else
        {
            text.Append(digits[0]);
            if (k > 1) text.Append('.').Append(digits, 1, k - 1);
            text.Append('e').Append(n - 1 >= 0 ? "+" : "-").Append(Math.Abs(n - 1).ToString(CultureInfo.InvariantCulture));
        }
        return text.ToString();
    }
}
