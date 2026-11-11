using System.Text.Json.Nodes;

namespace Crosswalk.Operators;

/// <summary>The operators and categories Crosswalk ships with. Their behaviour is defined by the conformance suite.</summary>
public static class BuiltinOperators
{
    public static IReadOnlyList<CategoryDefinition> Categories { get; } =
    [
        new("text", "Text"),
        new("math", "Math"),
        new("logic", "Logic"),
        new("date", "Date"),
        new("convert", "Convert"),
        new("flow", "Flow"),
        new("aggregate", "Aggregate"),
        new("custom", "Custom"),
    ];

    public static IReadOnlyList<OperatorDefinition> All { get; } = Build();

    // Inputs are checked against Inputs before Run is called, so a required argument is always there.
    private static Value Arg(IReadOnlyList<Value> args, int index) => index < args.Count ? args[index] : Value.Absent;

    private static ValueOperator Unary(string id, string label, string glyph, string category, Func<Value, Value> run) =>
        new() { Id = id, Label = label, Glyph = glyph, Category = category, Inputs = new(1, 1), Run = args => run(Arg(args, 0)) };

    private static ValueOperator Binary(string id, string label, string glyph, string category, Func<Value, Value, Value> run) =>
        new() { Id = id, Label = label, Glyph = glyph, Category = category, Inputs = new(2, 2), Run = args => run(Arg(args, 0), Arg(args, 1)) };

    private static AggregateOperator Aggregate(string id, string label, string glyph, Func<IReadOnlyList<JsonNode?>, Value> reduce) =>
        new() { Id = id, Label = label, Glyph = glyph, Category = "aggregate", Inputs = new(1, 1), Reduce = reduce };

    private static Value Number(double value) => Value.Of(JsonValue.Create(value));

    private static IEnumerable<double> Numbers(IEnumerable<Value> values) => values.Select(Coerce.ToNumber);

    private static IEnumerable<Value> Values(IReadOnlyList<JsonNode?> nodes) => nodes.Select(Value.Of);

    /// <summary>
    /// JavaScript's <c>String.prototype.slice</c>: positions round toward zero, and a
    /// negative one counts from the end.
    /// </summary>
    private static string Slice(string text, double start, double? end = null)
    {
        int Position(double value)
        {
            if (double.IsNaN(value)) return 0;
            var whole = Math.Truncate(value);
            if (whole < 0) return (int)Math.Max(text.Length + whole, 0);
            return (int)Math.Min(whole, text.Length);
        }
        var from = Position(start);
        var to = end is { } e ? Position(e) : text.Length;
        return to > from ? text[from..to] : "";
    }

    /// <summary>Rounds the decimal value as written, halves away from zero, so 1.005 to 2 places is 1.01.</summary>
    private static double Round(double value, int decimals)
    {
        // Beyond decimal's range a double is already a whole number, as far as any sensible rounding goes.
        if (Math.Abs(value) >= 7.9e27 || decimals > 28) return value;
        var exact = (decimal)value;
        if (decimals >= 0) return (double)Math.Round(exact, decimals, MidpointRounding.AwayFromZero);
        var scale = (decimal)Math.Pow(10, -decimals);
        return (double)(Math.Round(exact / scale, 0, MidpointRounding.AwayFromZero) * scale);
    }

    private static List<OperatorDefinition> Build() =>
    [
        // Text
        new ValueOperator
        {
            Id = "text.concat", Label = "Concatenate", Glyph = "ab+", Category = "text", Inputs = new(1),
            Run = args => string.Concat(args.Select(Coerce.ToText)),
        },
        Unary("text.upper", "Uppercase", "AB", "text", v => Coerce.ToText(v).ToUpperInvariant()),
        Unary("text.lower", "Lowercase", "ab", "text", v => Coerce.ToText(v).ToLowerInvariant()),
        Unary("text.trim", "Trim", "⎵", "text", v => Coerce.ToText(v).Trim()),
        Unary("text.length", "Length", "len", "text", v => Coerce.ToText(v).Length),
        new ValueOperator
        {
            Id = "text.left", Label = "Left", Glyph = "◧", Category = "text", Inputs = new(2, 2, ["text", "count"]),
            Description = "The first `count` characters.",
            Run = args => Slice(Coerce.ToText(Arg(args, 0)), 0, Math.Max(0, Coerce.ToNumber(Arg(args, 1)))),
        },
        new ValueOperator
        {
            Id = "text.right", Label = "Right", Glyph = "◨", Category = "text", Inputs = new(2, 2, ["text", "count"]),
            Description = "The last `count` characters.",
            Run = args =>
            {
                var text = Coerce.ToText(Arg(args, 0));
                return Slice(text, Math.Max(0, text.Length - Coerce.ToNumber(Arg(args, 1))));
            },
        },
        new ValueOperator
        {
            Id = "text.substring", Label = "Substring", Glyph = "sub", Category = "text", Inputs = new(2, 3, ["text", "start", "length"]),
            Description = "Takes `length` characters from a 0-based `start`, or the rest of the text when `length` is left out.",
            Run = args =>
            {
                var text = Coerce.ToText(Arg(args, 0));
                var start = Coerce.ToNumber(Arg(args, 1));
                return args.Count > 2 ? Slice(text, start, start + Coerce.ToNumber(Arg(args, 2))) : Slice(text, start);
            },
        },
        new ValueOperator
        {
            Id = "text.replace", Label = "Replace", Glyph = "⇄", Category = "text", Inputs = new(3, 3, ["text", "find", "replace with"]),
            Description = "Replaces every occurrence of `find` with `replace with`. An empty `find` leaves the text as it is.",
            Run = args =>
            {
                var text = Coerce.ToText(Arg(args, 0));
                var find = Coerce.ToText(Arg(args, 1));
                return find.Length == 0 ? text : text.Replace(find, Coerce.ToText(Arg(args, 2)), StringComparison.Ordinal);
            },
        },

        // Math
        new ValueOperator { Id = "math.add", Label = "Add", Glyph = "+", Category = "math", Inputs = new(2), Run = args => Number(Numbers(args).Aggregate(0.0, (sum, n) => sum + n)) },
        Binary("math.subtract", "Subtract", "−", "math", (a, b) => Number(Coerce.ToNumber(a) - Coerce.ToNumber(b))),
        new ValueOperator { Id = "math.multiply", Label = "Multiply", Glyph = "×", Category = "math", Inputs = new(2), Run = args => Number(Numbers(args).Aggregate(1.0, (product, n) => product * n)) },
        Binary("math.divide", "Divide", "÷", "math", (a, b) =>
        {
            var divisor = Coerce.ToNumber(b);
            if (divisor == 0) throw new OperatorException("Can't divide by zero");
            return Number(Coerce.ToNumber(a) / divisor);
        }),
        Binary("math.modulo", "Remainder", "%", "math", (a, b) => Number(Coerce.ToNumber(a) % Coerce.ToNumber(b))),
        new ValueOperator
        {
            Id = "math.round", Label = "Round", Glyph = "≈", Category = "math", Inputs = new(1, 2, ["value", "decimals"]),
            Description = "Rounds to `decimals` places (0 if left out), with halves rounded away from zero: 2.5 gives 3 and -2.5 gives -3.",
            Run = args =>
            {
                var decimals = args.Count > 1 ? Coerce.ToNumber(Arg(args, 1)) : 0;
                if (decimals != Math.Floor(decimals)) throw new OperatorException($"Decimals must be a whole number, not {Coerce.NumberToText(decimals)}");
                return Number(Round(Coerce.ToNumber(Arg(args, 0)), (int)decimals));
            },
        },
        Unary("math.abs", "Absolute", "|x|", "math", v => Number(Math.Abs(Coerce.ToNumber(v)))),
        new ValueOperator { Id = "math.min", Label = "Smallest", Glyph = "min", Category = "math", Inputs = new(2), Run = args => Number(Numbers(args).Min()) },
        new ValueOperator { Id = "math.max", Label = "Largest", Glyph = "max", Category = "math", Inputs = new(2), Run = args => Number(Numbers(args).Max()) },

        // Logic
        Binary("logic.equal", "Equals", "=", "logic", (a, b) => Coerce.Compare(a, b) == 0),
        Binary("logic.notEqual", "Not equal", "≠", "logic", (a, b) => Coerce.Compare(a, b) != 0),
        Binary("logic.greaterThan", "Greater than", ">", "logic", (a, b) => Coerce.Compare(a, b) > 0),
        Binary("logic.greaterOrEqual", "At least", "≥", "logic", (a, b) => Coerce.Compare(a, b) >= 0),
        Binary("logic.lessThan", "Less than", "<", "logic", (a, b) => Coerce.Compare(a, b) < 0),
        Binary("logic.lessOrEqual", "At most", "≤", "logic", (a, b) => Coerce.Compare(a, b) <= 0),
        new ValueOperator { Id = "logic.and", Label = "And", Glyph = "∧", Category = "logic", Inputs = new(2), Run = args => args.All(Coerce.ToBoolean) },
        new ValueOperator { Id = "logic.or", Label = "Or", Glyph = "∨", Category = "logic", Inputs = new(2), Run = args => args.Any(Coerce.ToBoolean) },
        Unary("logic.not", "Not", "!", "logic", v => !Coerce.ToBoolean(v)),
        Unary("logic.isNumber", "Is a number", "1?", "logic", v => Coerce.IsNumeric(v)),
        new ValueOperator
        {
            Id = "logic.exists", Label = "Exists", Glyph = "∃", Category = "logic", Inputs = new(1, 1), HandlesAbsent = true,
            Description = "True when the input has a value. `null` counts as a value.",
            Run = args => !Arg(args, 0).IsAbsent,
        },

        // Date
        .. Dates.Operators,

        // Convert
        Unary("convert.toNumber", "To number", "→1", "convert", v => Number(Coerce.ToNumber(v))),
        Unary("convert.toText", "To text", "→a", "convert", v => Coerce.ToText(v)),
        Unary("convert.toBoolean", "To true/false", "→?", "convert", v => Coerce.ToBoolean(v)),
        new ValueOperator
        {
            Id = "convert.lookup", Label = "Look up", Glyph = "tbl", Category = "convert", Inputs = new(2, 3, ["value", "table", "if not found"], [1]), HandlesAbsent = true,
            Description = "Finds the value in a table, such as `{ \"M\": \"Male\" }`, and gives what it maps to. With no match it gives `if not found`, or leaves the field out.",
            Run = args =>
            {
                var value = Arg(args, 0);
                var table = Arg(args, 1);
                // A missing value is no value, not a value missing from the table.
                if (value.IsAbsent || table.IsAbsent) return Value.Absent;
                if (table.Node is not JsonObject entries) throw new OperatorException("The table must be an object of keys and values");
                return entries.TryGetPropertyValue(Coerce.ToText(value), out var found) ? Value.Of(found) : Arg(args, 2);
            },
        },

        // Flow
        new ValueOperator
        {
            Id = "flow.onlyIf", Label = "Only if", Glyph = "⇥", Category = "flow", Inputs = new(2, 2, ["condition", "value"]),
            Description = "Passes the value through when the condition is true; otherwise the output is left out.",
            Run = args => Coerce.ToBoolean(Arg(args, 0)) ? Arg(args, 1) : Value.Absent,
        },
        new ValueOperator
        {
            Id = "flow.ifElse", Label = "If / else", Glyph = "?:", Category = "flow", Inputs = new(3, 3, ["condition", "then", "else"]), HandlesAbsent = true,
            Run = args =>
            {
                var condition = Arg(args, 0);
                if (condition.IsAbsent) return Value.Absent;
                return Coerce.ToBoolean(condition) ? Arg(args, 1) : Arg(args, 2);
            },
        },
        new ValueOperator
        {
            Id = "flow.firstOf", Label = "First of", Glyph = "??", Category = "flow", Inputs = new(1), HandlesAbsent = true,
            Description = "The first input that has a value and isn't `null`.",
            Run = args => args.FirstOrDefault(v => !v.IsAbsent && !v.IsNull),
        },

        // Aggregate
        Aggregate("aggregate.sum", "Sum", "Σ", values => Number(Numbers(Values(values)).Aggregate(0.0, (sum, n) => sum + n))),
        Aggregate("aggregate.count", "Count", "#", values => values.Count),
        Aggregate("aggregate.average", "Average", "x̄", values => values.Count == 0 ? Value.Absent : Number(Numbers(Values(values)).Aggregate(0.0, (sum, n) => sum + n) / values.Count)),
        Aggregate("aggregate.min", "Minimum", "↓", values => values.Count == 0 ? Value.Absent : Number(Numbers(Values(values)).Min())),
        Aggregate("aggregate.max", "Maximum", "↑", values => values.Count == 0 ? Value.Absent : Number(Numbers(Values(values)).Max())),
        Aggregate("aggregate.join", "Join", "Σab", values => string.Concat(Values(values).Select(Coerce.ToText))),
    ];
}
