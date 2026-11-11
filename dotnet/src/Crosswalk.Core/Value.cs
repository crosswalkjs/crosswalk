using System.Text.Json.Nodes;

namespace Crosswalk;

/// <summary>
/// A value flowing through a map: a JSON value, which may be JSON <c>null</c>, or no value at all.
/// </summary>
/// <remarks>
/// "No value" (<see cref="Absent"/>) is what a missing source field produces, and what an
/// operator returns to leave its target field out. It's different from JSON <c>null</c>,
/// which is a real value: it's copied, counted and compared like any other.
/// </remarks>
public readonly struct Value : IEquatable<Value>
{
    private readonly JsonNode? _node;
    private readonly bool _present;

    private Value(JsonNode? node, bool present)
    {
        _node = node;
        _present = present;
    }

    /// <summary>No value: the target field is left out.</summary>
    public static Value Absent => default;

    /// <summary>JSON <c>null</c>.</summary>
    public static Value Null => new(null, true);

    /// <summary>A JSON value. A C# <c>null</c> node is JSON <c>null</c>, not <see cref="Absent"/>.</summary>
    public static Value Of(JsonNode? node) => new(node, true);

    /// <summary>True when there's no value.</summary>
    public bool IsAbsent => !_present;

    /// <summary>True for JSON <c>null</c>.</summary>
    public bool IsNull => _present && _node is null;

    /// <summary>The JSON value. <c>null</c> for JSON <c>null</c>, and for <see cref="Absent"/>: check <see cref="IsAbsent"/> first.</summary>
    public JsonNode? Node => _node;

    /// <summary>The kind of JSON value, or <c>null</c> when absent.</summary>
    public System.Text.Json.JsonValueKind? Kind =>
        !_present ? null : _node is null ? System.Text.Json.JsonValueKind.Null : _node.GetValueKind();

    public static implicit operator Value(string? value) => value is null ? Null : Of(JsonValue.Create(value));
    public static implicit operator Value(bool value) => Of(JsonValue.Create(value));
    public static implicit operator Value(double value) => Of(JsonValue.Create(value));
    public static implicit operator Value(int value) => Of(JsonValue.Create(value));
    public static implicit operator Value(long value) => Of(JsonValue.Create(value));
    public static implicit operator Value(decimal value) => Of(JsonValue.Create(value));
    public static implicit operator Value(JsonNode? node) => Of(node);

    public bool Equals(Value other) =>
        _present == other._present && (_node is null ? other._node is null : JsonNode.DeepEquals(_node, other._node));

    public override bool Equals(object? obj) => obj is Value other && Equals(other);

    public override int GetHashCode() => !_present ? 0 : _node is null ? 1 : _node.ToJsonString().GetHashCode();

    public static bool operator ==(Value left, Value right) => left.Equals(right);

    public static bool operator !=(Value left, Value right) => !left.Equals(right);

    public override string ToString() => !_present ? "(absent)" : _node is null ? "null" : _node.ToJsonString();
}
