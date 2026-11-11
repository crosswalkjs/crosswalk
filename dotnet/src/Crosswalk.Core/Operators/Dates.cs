using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Crosswalk.Operators;

/// <summary>
/// The date operators. Dates are text: <c>YYYY-MM-DD</c>, or <c>YYYY-MM-DDTHH:mm</c>, with
/// optional seconds and a <c>Z</c>. The calendar arithmetic is done here, from the year,
/// month and day, rather than with <see cref="DateTime"/>, so it matches the JavaScript
/// runtime exactly and no time zone gets involved.
/// </summary>
internal static partial class Dates
{
    private sealed record Time(int Hour, int Minute, int Second);

    private sealed record DateParts(int Year, int Month, int Day, Time? Time, bool Utc);

    [GeneratedRegex(@"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z)?)?$")]
    private static partial Regex DatePattern();

    private static string Pad(int value, int width = 2) => value.ToString(System.Globalization.CultureInfo.InvariantCulture).PadLeft(width, '0');

    private static bool IsLeap(int year) => (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;

    private static int DaysInMonth(int year, int month) => month switch
    {
        2 => IsLeap(year) ? 29 : 28,
        4 or 6 or 9 or 11 => 30,
        _ => 31,
    };

    private static DateParts Check(DateParts parts, string text)
    {
        var valid = parts.Month is >= 1 and <= 12 && parts.Day >= 1 && parts.Day <= DaysInMonth(parts.Year, parts.Month)
            && (parts.Time is null || (parts.Time.Hour <= 23 && parts.Time.Minute <= 59 && parts.Time.Second <= 59));
        return valid ? parts : throw new OperatorException($"\"{text}\" isn't a real date");
    }

    private static DateParts Read(Value value)
    {
        var text = Coerce.ToText(value).Trim();
        var found = DatePattern().Match(text);
        if (!found.Success) throw new OperatorException($"Expected a date such as 2026-03-04, or 2026-03-04T09:30, but got \"{text}\"");
        int Group(int index) => int.Parse(found.Groups[index].Value, System.Globalization.CultureInfo.InvariantCulture);
        var time = found.Groups[4].Success ? new Time(Group(4), Group(5), found.Groups[6].Success ? Group(6) : 0) : null;
        return Check(new DateParts(Group(1), Group(2), Group(3), time, found.Groups[7].Success), text);
    }

    private static string Write(DateParts parts)
    {
        if (parts.Year is < 1 or > 9999) throw new OperatorException("The date goes outside the years 1 to 9999");
        var date = $"{Pad(parts.Year, 4)}-{Pad(parts.Month)}-{Pad(parts.Day)}";
        return parts.Time is { } t ? $"{date}T{Pad(t.Hour)}:{Pad(t.Minute)}:{Pad(t.Second)}{(parts.Utc ? "Z" : "")}" : date;
    }

    private static long FloorDiv(long a, long b) => (long)Math.Floor((double)a / b);

    /// <summary>Days since 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's days_from_civil).</summary>
    private static long DaysFromCivil(int year, int month, int day)
    {
        long y = month <= 2 ? year - 1 : year;
        var era = FloorDiv(y, 400);
        var yearOfEra = y - era * 400;
        var dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
        var dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
        return era * 146097 + dayOfEra - 719468;
    }

    /// <summary>The date <paramref name="days"/> after 1970-01-01.</summary>
    private static (int Year, int Month, int Day) CivilFromDays(long days)
    {
        var z = days + 719468;
        var era = FloorDiv(z, 146097);
        var dayOfEra = z - era * 146097;
        var yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365;
        var dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100);
        var mp = (5 * dayOfYear + 2) / 153;
        var day = (int)(dayOfYear - (153 * mp + 2) / 5 + 1);
        var month = (int)(mp < 10 ? mp + 3 : mp - 9);
        return ((int)(yearOfEra + era * 400 + (month <= 2 ? 1 : 0)), month, day);
    }

    private static int SecondsOfDay(DateParts parts) => parts.Time is { } t ? t.Hour * 3600 + t.Minute * 60 + t.Second : 0;

    private static string ReadUnit(Value value)
    {
        var unit = Coerce.ToText(value).Trim().ToLowerInvariant();
        var plural = unit.EndsWith('s') ? unit : unit + "s";
        return plural is "days" or "months" or "years" ? plural : throw new OperatorException($"The unit must be days, months or years, not \"{Coerce.ToText(value)}\"");
    }

    private static int ReadWhole(Value value)
    {
        var number = Coerce.ToNumber(value);
        return number == Math.Floor(number) && !double.IsInfinity(number) ? (int)number : throw new OperatorException($"Expected a whole number but got {Coerce.NumberToText(number)}");
    }

    private static DateParts Add(DateParts parts, int amount, string unit)
    {
        if (unit == "days")
        {
            var (year, month, day) = CivilFromDays(DaysFromCivil(parts.Year, parts.Month, parts.Day) + amount);
            return parts with { Year = year, Month = month, Day = day };
        }
        var months = (long)parts.Year * 12 + (parts.Month - 1) + (unit == "years" ? amount * 12L : amount);
        var newYear = (int)FloorDiv(months, 12);
        var newMonth = (int)(months - newYear * 12L + 1);
        // The 31st plus a month stops at the end of a shorter month.
        return parts with { Year = newYear, Month = newMonth, Day = Math.Min(parts.Day, DaysInMonth(newYear, newMonth)) };
    }

    /// <summary>Whole days, months or years from one date to another, counting toward zero.</summary>
    private static long Difference(DateParts from, DateParts to, string unit)
    {
        if (unit == "days")
        {
            var seconds = (DaysFromCivil(to.Year, to.Month, to.Day) - DaysFromCivil(from.Year, from.Month, from.Day)) * 86400 + SecondsOfDay(to) - SecondsOfDay(from);
            return seconds / 86400;
        }
        long months = (to.Year - from.Year) * 12 + (to.Month - from.Month);
        // A month only counts once its day, and time, has come round again.
        var later = to.Day * 86400L + SecondsOfDay(to) - (from.Day * 86400L + SecondsOfDay(from));
        if (months > 0 && later < 0) months--;
        else if (months < 0 && later > 0) months++;
        return unit == "months" ? months : months / 12;
    }

    private static readonly string[] MonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    // Longest first, so MMM is read before MM and M.
    private static readonly string[] Tokens = ["yyyy", "MMM", "yy", "MM", "dd", "HH", "mm", "ss", "M", "d"];

    private static string? TokenAt(string pattern, int index) => Tokens.FirstOrDefault(token => string.CompareOrdinal(pattern, index, token, 0, token.Length) == 0);

    private static string Format(DateParts parts, string pattern)
    {
        var time = parts.Time ?? new Time(0, 0, 0);
        var output = new System.Text.StringBuilder();
        for (var i = 0; i < pattern.Length;)
        {
            var token = TokenAt(pattern, i);
            output.Append(token switch
            {
                "yyyy" => Pad(parts.Year, 4),
                "yy" => Pad(parts.Year % 100),
                "MMM" => MonthNames[parts.Month - 1],
                "MM" => Pad(parts.Month),
                "M" => parts.Month.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "dd" => Pad(parts.Day),
                "d" => parts.Day.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "HH" => Pad(time.Hour),
                "mm" => Pad(time.Minute),
                "ss" => Pad(time.Second),
                _ => pattern[i].ToString(),
            });
            i += token?.Length ?? 1;
        }
        return output.ToString();
    }

    private static DateParts Parse(string text, string pattern)
    {
        OperatorException Fail() => new($"\"{text}\" doesn't match the pattern \"{pattern}\"");
        var read = new Dictionary<string, int>();
        var at = 0;
        for (var i = 0; i < pattern.Length;)
        {
            var token = TokenAt(pattern, i);
            if (token is null)
            {
                if (at >= text.Length || text[at] != pattern[i]) throw Fail();
                at++;
                i++;
                continue;
            }
            if (token == "MMM")
            {
                var name = at + 3 <= text.Length ? text.Substring(at, 3) : "";
                var month = Array.FindIndex(MonthNames, m => string.Equals(m, name, StringComparison.OrdinalIgnoreCase));
                if (month < 0) throw Fail();
                read["MM"] = month + 1;
                at += 3;
            }
            else
            {
                // Fixed width for doubled tokens; one or two digits for M and d.
                static bool Digit(string s, int index) => index < s.Length && s[index] is >= '0' and <= '9';
                var width = token == "yyyy" ? 4 : token is "M" or "d" ? (Digit(text, at) && Digit(text, at + 1) ? 2 : 1) : 2;
                for (var k = 0; k < width; k++)
                {
                    if (!Digit(text, at + k)) throw Fail();
                }
                read[token == "M" ? "MM" : token == "d" ? "dd" : token] = int.Parse(text.AsSpan(at, width), provider: System.Globalization.CultureInfo.InvariantCulture);
                at += width;
            }
            i += token.Length;
        }
        if (at != text.Length) throw Fail();
        int? year = read.TryGetValue("yyyy", out var y) ? y : read.TryGetValue("yy", out var yy) ? 2000 + yy : null;
        if (year is null || !read.TryGetValue("MM", out var mm) || !read.TryGetValue("dd", out var dd))
            throw new OperatorException($"The pattern \"{pattern}\" needs a year, a month and a day");
        var timed = read.ContainsKey("HH") || read.ContainsKey("mm") || read.ContainsKey("ss");
        var time = timed ? new Time(read.GetValueOrDefault("HH"), read.GetValueOrDefault("mm"), read.GetValueOrDefault("ss")) : null;
        return Check(new DateParts(year.Value, mm, dd, time, false), text);
    }

    private static int Part(DateParts parts, string name) => name.Trim().ToLowerInvariant() switch
    {
        "year" => parts.Year,
        "month" => parts.Month,
        "day" => parts.Day,
        // ISO: Monday is 1 and Sunday 7. 1970-01-01 was a Thursday.
        "weekday" => (int)(((DaysFromCivil(parts.Year, parts.Month, parts.Day) + 3) % 7 + 7) % 7) + 1,
        "hour" => parts.Time?.Hour ?? 0,
        "minute" => parts.Time?.Minute ?? 0,
        "second" => parts.Time?.Second ?? 0,
        _ => throw new OperatorException($"The part must be one of year, month, day, weekday, hour, minute, second, not \"{name}\""),
    };

    /// <summary>Today's date in UTC. Swappable, so tests can fix it.</summary>
    internal static Func<string> Today { get; set; } = () =>
    {
        var now = DateTime.UtcNow;
        return Write(new DateParts(now.Year, now.Month, now.Day, null, false));
    };

    private static Value Number(double value) => Value.Of(JsonValue.Create(value));

    public static IEnumerable<OperatorDefinition> Operators =>
    [
        new ValueOperator
        {
            Id = "date.today", Label = "Today", Glyph = "now", Category = "date", Inputs = new(0, 0),
            Description = "Today's date, in UTC, such as `2026-03-04`.",
            Run = _ => Today(),
        },
        new ValueOperator
        {
            Id = "date.parse", Label = "Read date", Glyph = "rd", Category = "date", Inputs = new(2, 2, ["text", "pattern"]),
            Description = "Reads a date written another way, such as `04/03/2026` with the pattern `dd/MM/yyyy`, as `2026-03-04`. The pattern uses `yyyy`, `yy`, `MMM`, `MM`, `M`, `dd`, `d`, `HH`, `mm` and `ss`; anything else must match exactly.",
            Run = args => Write(Parse(Coerce.ToText(args[0]), Coerce.ToText(args[1]))),
        },
        new ValueOperator
        {
            Id = "date.format", Label = "Format date", Glyph = "fmt", Category = "date", Inputs = new(2, 2, ["date", "pattern"]),
            Description = "Writes a date with a pattern, such as `dd MMM yyyy` for `04 Mar 2026`. The pattern uses `yyyy`, `yy`, `MMM`, `MM`, `M`, `dd`, `d`, `HH`, `mm` and `ss`.",
            Run = args => Format(Read(args[0]), Coerce.ToText(args[1])),
        },
        new ValueOperator
        {
            Id = "date.add", Label = "Add to date", Glyph = "+dt", Category = "date", Inputs = new(3, 3, ["date", "amount", "unit"]),
            Description = "Adds whole days, months or years to a date; a negative amount goes back. The 31st plus a month stops at the end of a shorter month.",
            Run = args => Write(Add(Read(args[0]), ReadWhole(args[1]), ReadUnit(args[2]))),
        },
        new ValueOperator
        {
            Id = "date.diff", Label = "Date difference", Glyph = "Δdt", Category = "date", Inputs = new(3, 3, ["from", "to", "unit"]),
            Description = "Whole days, months or years from one date to another, such as an age in years from a date of birth to today.",
            Run = args => Number(Difference(Read(args[0]), Read(args[1]), ReadUnit(args[2]))),
        },
        new ValueOperator
        {
            Id = "date.part", Label = "Part of date", Glyph = "dt.", Category = "date", Inputs = new(2, 2, ["date", "part"]),
            Description = "One part of a date as a number: year, month, day, weekday (Monday is 1), hour, minute or second.",
            Run = args => Number(Part(Read(args[0]), Coerce.ToText(args[1]))),
        },
    ];
}
