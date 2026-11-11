using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Crosswalk.Operators;

/// <summary>
/// How many inputs an operator takes. A null <see cref="Max"/> means no limit.
/// <see cref="Tables"/> lists the inputs that take a table of keys and values,
/// such as Look up's, so the editor offers a table there.
/// </summary>
public sealed record OperatorInputs(int Min, int? Max = null, IReadOnlyList<string>? Labels = null, IReadOnlyList<int>? Tables = null);

/// <summary>An operator a map can use: built in, or your own.</summary>
public abstract class OperatorDefinition
{
    /// <summary>A namespaced id, such as <c>text.concat</c>. Maps refer to operators by it.</summary>
    public required string Id { get; init; }

    public required string Label { get; init; }

    /// <summary>The id of a registered category.</summary>
    public required string Category { get; init; }

    public required OperatorInputs Inputs { get; init; }

    /// <summary>A short symbol the editor draws on the operator, such as <c>Σ</c>.</summary>
    public string? Glyph { get; init; }

    public string? Description { get; init; }

    /// <summary>
    /// When false (the default) an absent input makes the output absent without
    /// calling the operator. Set it for operators that test for absence.
    /// </summary>
    public bool HandlesAbsent { get; init; }
}

/// <summary>Works out one value from its inputs.</summary>
public sealed class ValueOperator : OperatorDefinition
{
    public required Func<IReadOnlyList<Value>, Value> Run { get; init; }
}

/// <summary>
/// Works out one value from its inputs, but has to wait for it, such as a lookup
/// in a database or another service. Maps that use one need <see cref="MapTransform.RunAsync(System.Text.Json.Nodes.JsonNode, CancellationToken)"/>.
/// </summary>
public sealed class AsyncValueOperator : OperatorDefinition
{
    /// <summary>Pass the token on to whatever you call, so a cancelled run stops your work too.</summary>
    public required Func<IReadOnlyList<Value>, CancellationToken, ValueTask<Value>> Run { get; init; }
}

/// <summary>Aggregates one input across every item of the node's scope, such as a sum.</summary>
public sealed class AggregateOperator : OperatorDefinition
{
    /// <summary>Gets the input's value for each item, with absent values already dropped. JSON <c>null</c> is a C# null.</summary>
    public required Func<IReadOnlyList<JsonNode?>, Value> Reduce { get; init; }
}

/// <summary>A group of operators in the editor's toolbox.</summary>
public sealed partial record CategoryDefinition
{
    public CategoryDefinition(string id, string label, string? color = null)
    {
        if (!IdPattern().IsMatch(id))
            throw new ArgumentException($"Category id \"{id}\" must start with a letter and use only letters, digits, - and _", nameof(id));
        Id = id;
        Label = label;
        Color = color;
    }

    /// <summary>Letters, digits, <c>-</c> and <c>_</c>, starting with a letter.</summary>
    public string Id { get; }

    public string Label { get; }

    /// <summary>The colour of the category's operators in the editor, when the theme doesn't set one.</summary>
    public string? Color { get; }

    [GeneratedRegex("^[A-Za-z][A-Za-z0-9_-]*$")]
    private static partial Regex IdPattern();
}

/// <summary>Thrown by an operator when its inputs don't make sense, such as text where a number belongs.</summary>
public sealed class OperatorException(string message) : Exception(message);
