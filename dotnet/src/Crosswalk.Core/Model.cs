using System.Text.Json;
using System.Text.Json.Nodes;

namespace Crosswalk;

/// <summary>The subset of JSON Schema a map uses: shape, not validation rules.</summary>
public sealed class Schema
{
    /// <summary><c>object</c>, <c>array</c>, <c>string</c>, <c>number</c>, <c>integer</c>, <c>boolean</c> or <c>null</c>.</summary>
    public required string Type { get; init; }

    public string? Title { get; init; }

    /// <summary>An object's properties, in the order the schema lists them. Output follows this order.</summary>
    public IReadOnlyList<KeyValuePair<string, Schema>> Properties { get; init; } = [];

    /// <summary>An array's item schema.</summary>
    public Schema? Items { get; init; }

    internal Schema? Property(string key)
    {
        foreach (var (name, schema) in Properties)
        {
            if (name == key) return schema;
        }
        return null;
    }

    /// <summary>The properties a value must have. A required target field with nothing mapped to it is a warning.</summary>
    public IReadOnlyList<string> Required { get; init; } = [];

    /// <summary>For a <c>$ref</c> the root schema doesn't define: the reference.</summary>
    internal string? UnresolvedRef { get; init; }

    /// <summary>Where the field sits in XML, from the schema's <c>xml</c>. See <see cref="XmlJson"/>.</summary>
    public XmlHint? Xml { get; init; }

    /// <summary>How a flat file is laid out, or where a column sits in one, from the schema's <c>flat</c>. See <see cref="FlatFile"/>.</summary>
    public FlatHint? Flat { get; init; }

    /// <summary>
    /// Reads a schema as one plain shape. It keeps <c>type</c>, <c>title</c>, <c>properties</c>,
    /// <c>items</c> and <c>required</c>; replaces a local <c>$ref</c> to the root's <c>$defs</c> or
    /// <c>definitions</c> with what it points at; merges <c>allOf</c> in; and reads <c>oneOf</c> and
    /// <c>anyOf</c> as one record with every alternative's fields, required only where every
    /// alternative requires them, leaving out <c>null</c> alternatives. A <c>type</c> list reads as its
    /// first type that isn't <c>null</c>. A reference back to a schema it's already inside stops
    /// there, as a record with no fields listed.
    /// </summary>
    public static Schema FromJson(JsonNode? json, string where = "schema") => Read(json, where, json as JsonObject, []);

    private static Schema Read(JsonNode? json, string where, JsonObject? root, IReadOnlyList<string> inside)
    {
        if (json is not JsonObject obj) throw new MapFormatException($"The {where} must be an object");
        static string? Text(JsonNode? node) => node is JsonValue value && value.GetValueKind() == JsonValueKind.String ? value.GetValue<string>() : null;
        var title = Text(obj["title"]);
        if (Text(obj["$ref"]) is { } reference)
        {
            var target = LookUp(root, reference);
            if (target is null) return new Schema { Type = "object", Title = title, UnresolvedRef = reference };
            if (inside.Contains(target.Value.Name)) return new Schema { Type = Text(target.Value.Json["type"]) ?? "object", Title = title ?? Text(target.Value.Json["title"]) };
            // Anything written beside the $ref, such as a title, adds to what it points at.
            var merged = (JsonObject)target.Value.Json.DeepClone();
            foreach (var (key, value) in obj)
            {
                if (key != "$ref") merged[key] = value?.DeepClone();
            }
            return Read(merged, where, root, [.. inside, target.Value.Name]);
        }
        var properties = new List<KeyValuePair<string, Schema>>();
        if (obj["properties"] is JsonObject props)
        {
            foreach (var (name, child) in props) properties.Add(new(name, Read(child, $"{where}'s property \"{name}\"", root, inside)));
        }
        var schema = new Schema
        {
            // Unknown until the parts are merged in, then a record.
            Type = TypeOf(obj) ?? "",
            Title = title,
            Properties = properties,
            Items = obj["items"] is JsonNode items ? Read(items, $"{where}'s items", root, inside) : null,
            Required = obj["required"] is JsonArray required ? [.. required.Select(Text).OfType<string>()] : [],
            Xml = obj["xml"] is JsonObject xml ? XmlHint.FromJson(xml) : null,
            Flat = obj["flat"] is JsonObject flat ? FlatHint.FromJson(flat) : null,
        };
        if (obj["allOf"] is JsonArray all)
        {
            for (var i = 0; i < all.Count; i++) schema = Combine(schema, Read(all[i], $"{where}'s allOf {i + 1}", root, inside), alternatives: false);
        }
        if ((obj["oneOf"] ?? obj["anyOf"]) is JsonArray either)
        {
            var shapes = either.Select((part, i) => Read(part, $"{where}'s alternative {i + 1}", root, inside)).Where(shape => shape.Type != "null").ToList();
            if (shapes.Count > 0) schema = Combine(schema, shapes.Skip(1).Aggregate(shapes[0], (a, b) => Combine(a, b, alternatives: true)), alternatives: false);
        }
        return schema.Type == "" ? schema.WithType("object") : schema;
    }

    /// <summary>
    /// The type a schema gives, as one type. A list, such as <c>["string", "null"]</c>, reads as its
    /// first type that isn't <c>null</c>; no type at all is a record if it has properties, an array if
    /// it has items.
    /// </summary>
    private static string? TypeOf(JsonObject obj)
    {
        switch (obj["type"])
        {
            case JsonValue value when value.GetValueKind() == JsonValueKind.String:
                return value.GetValue<string>();
            case JsonArray list:
                var types = list.OfType<JsonValue>().Where(v => v.GetValueKind() == JsonValueKind.String).Select(v => v.GetValue<string>()).ToList();
                return types.FirstOrDefault(t => t != "null") ?? types.FirstOrDefault();
        }
        if (obj["properties"] is not null) return "object";
        if (obj["items"] is not null) return "array";
        // A const or enum says what its values are.
        if (!obj.ContainsKey("const") && obj["enum"] is not JsonArray) return null;
        var example = obj.ContainsKey("const") ? obj["const"] : ((JsonArray)obj["enum"]!).FirstOrDefault(v => v is not null);
        return example switch
        {
            null => "null",
            JsonArray => "array",
            JsonObject => "object",
            JsonValue v when v.GetValueKind() == JsonValueKind.String => "string",
            JsonValue v when v.GetValueKind() is JsonValueKind.True or JsonValueKind.False => "boolean",
            JsonValue v when v.TryGetValue<long>(out _) => "integer",
            _ => "number",
        };
    }

    /// <summary>
    /// Two shapes as one. Records keep the first's fields in order, then the second's new ones,
    /// merging fields both have. <c>required</c> is everything either requires, or, for
    /// alternatives, only what both require. Shapes of different types can't be merged, so the
    /// first is kept.
    /// </summary>
    private static Schema Combine(Schema a, Schema b, bool alternatives)
    {
        if (a.Type != "" && b.Type != "" && a.Type != b.Type) return a;
        var type = a.Type != "" ? a.Type : b.Type;
        var properties = a.Properties.ToList();
        foreach (var (name, schema) in b.Properties)
        {
            var at = properties.FindIndex(p => p.Key == name);
            if (at < 0) properties.Add(new(name, schema));
            else properties[at] = new(name, Combine(properties[at].Value, schema, alternatives));
        }
        return new Schema
        {
            Type = type,
            Title = a.Title ?? b.Title,
            Properties = type == "object" ? properties : [],
            Items = a.Items is { } x && b.Items is { } y ? Combine(x, y, alternatives) : a.Items ?? b.Items,
            Required = alternatives ? [.. a.Required.Where(b.Required.Contains)] : [.. a.Required.Union(b.Required)],
            UnresolvedRef = a.UnresolvedRef ?? b.UnresolvedRef,
            Xml = a.Xml ?? b.Xml,
            Flat = a.Flat ?? b.Flat,
        };
    }

    private Schema WithType(string type) => new()
    {
        Type = type,
        Title = Title,
        Properties = Properties,
        Items = Items,
        Required = Required,
        UnresolvedRef = UnresolvedRef,
        Xml = Xml,
        Flat = Flat,
    };

    /// <summary>The schema a local <c>$ref</c> points at, or null when the root doesn't define it.</summary>
    private static (string Name, JsonObject Json)? LookUp(JsonObject? root, string reference)
    {
        var found = System.Text.RegularExpressions.Regex.Match(reference, @"^#/(\$defs|definitions)/(.+)$");
        if (!found.Success || root?[found.Groups[1].Value] is not JsonObject definitions) return null;
        // A JSON pointer escapes "/" as "~1" and "~" as "~0".
        var name = Uri.UnescapeDataString(found.Groups[2].Value).Replace("~1", "/").Replace("~0", "~");
        return definitions[name] is JsonObject schema ? ($"{found.Groups[1].Value}/{name}", schema) : null;
    }
}

/// <summary>An operator on the map's grid.</summary>
public sealed class OperatorNode
{
    public required string Id { get; init; }

    /// <summary>The id of an operator in the registry, such as <c>text.concat</c>.</summary>
    public required string Operator { get; init; }

    /// <summary>Fixed values for inputs that aren't linked, by input index.</summary>
    public IReadOnlyDictionary<int, JsonNode?> Constants { get; init; } = new Dictionary<int, JsonNode?>();

    /// <summary>For an aggregate operator: the source array it aggregates over, such as <c>PhoneCalls[]</c>.</summary>
    public string? Scope { get; init; }
}

/// <summary>One end of a link: a source or target field, or a node.</summary>
public sealed class LinkEnd
{
    /// <summary>A source field's path, for the start of a link.</summary>
    public string? Source { get; init; }

    /// <summary>A target field's path, for the end of a link.</summary>
    public string? Target { get; init; }

    /// <summary>A node's id: its output at the start of a link, or one of its inputs at the end.</summary>
    public string? Node { get; init; }

    /// <summary>Which input of <see cref="Node"/>, at the end of a link.</summary>
    public int? Input { get; init; }
}

/// <summary>
/// A line from a source field or a node, to a target field or a node's input. A link between
/// two records copies the source record whole, or maps it with a sub-map.
/// </summary>
public sealed class Link
{
    public required LinkEnd From { get; init; }
    public required LinkEnd To { get; init; }

    /// <summary>For a link between records: the name of the sub-map to map it with.</summary>
    public string? Submap { get; init; }
}

/// <summary>
/// Repeats a target array once per item of a source array: sorted, grouped and
/// de-duplicated on the way, in that order, when asked.
/// </summary>
public sealed class Loop
{
    public required string Source { get; init; }
    public required string Target { get; init; }

    /// <summary>Orders the source items by these fields, first key first. The sort is stable and missing values go last.</summary>
    public IReadOnlyList<SortKey> SortBy { get; init; } = [];

    /// <summary>
    /// Makes one target item per distinct value of this field, in the order each first appears.
    /// Inside the group, a field reads from the group's first item, and an aggregate over the
    /// loop's source array covers the group's items.
    /// </summary>
    public string? GroupBy { get; init; }

    /// <summary>Leaves out a target item identical to an earlier one.</summary>
    public bool Distinct { get; init; }
}

/// <summary>A field of a loop's source item to sort by.</summary>
public sealed record SortKey(string Path, bool Descending = false);

/// <summary>A Crosswalk map: how to build the target JSON from the source JSON.</summary>
public sealed class MapDocument
{
    public required int Version { get; init; }
    public required Schema Source { get; init; }
    public required Schema Target { get; init; }
    public IReadOnlyList<OperatorNode> Nodes { get; init; } = [];
    public IReadOnlyList<Link> Links { get; init; } = [];
    public IReadOnlyList<Loop> Loops { get; init; } = [];

    /// <summary>
    /// Reusable maps for records, by name. A record link names one to map a source record into
    /// a target record. Sub-maps use their document's sub-maps, so theirs is always empty.
    /// </summary>
    public IReadOnlyDictionary<string, MapDocument> Submaps { get; init; } = new Dictionary<string, MapDocument>();

    /// <summary>Reads a map from the JSON the editor saves. Throws <see cref="MapFormatException"/> if it isn't shaped like a map.</summary>
    public static MapDocument Parse(string json)
    {
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(json);
        }
        catch (JsonException error)
        {
            throw new MapFormatException($"The map isn't valid JSON: {error.Message}", error);
        }
        return FromJson(node);
    }

    /// <summary>Reads a map from parsed JSON. Throws <see cref="MapFormatException"/> if it isn't shaped like a map.</summary>
    public static MapDocument FromJson(JsonNode? json)
    {
        if (json is not JsonObject map) throw new MapFormatException("A map must be a JSON object");
        return new MapDocument
        {
            Version = Operators.Coerce.NumberIn(map["version"]) is { } version && version == Math.Floor(version)
                ? (int)version
                : throw new MapFormatException("The map needs a whole-number \"version\""),
            Source = Schema.FromJson(map["source"], "source schema"),
            Target = Schema.FromJson(map["target"], "target schema"),
            Nodes = Array(map, "nodes").Select(ReadNode).ToList(),
            Links = Array(map, "links").Select((link, index) => ReadLink(link, index)).ToList(),
            Loops = Array(map, "loops", optional: true).Select(ReadLoop).ToList(),
            Submaps = map["submaps"] is JsonObject submaps
                ? submaps.ToDictionary(entry => entry.Key, entry => ReadSubmap(entry.Key, entry.Value))
                : new Dictionary<string, MapDocument>(),
        };
    }

    /// <summary>A sub-map is shaped like a map without a version, and without sub-maps of its own.</summary>
    private static MapDocument ReadSubmap(string name, JsonNode? json)
    {
        if (json is not JsonObject submap) throw new MapFormatException($"Sub-map \"{name}\" must be an object");
        var copy = (JsonObject)submap.DeepClone();
        copy["version"] = 1;
        copy.Remove("submaps");
        try
        {
            return FromJson(copy);
        }
        catch (MapFormatException error)
        {
            throw new MapFormatException($"In sub-map \"{name}\": {error.Message}", error);
        }
    }

    private static IEnumerable<JsonObject> Array(JsonObject map, string name, bool optional = false)
    {
        var node = map[name];
        if (node is null && optional) return [];
        if (node is not JsonArray array) throw new MapFormatException($"The map needs a \"{name}\" array");
        return array.Select((item, index) => item as JsonObject ?? throw new MapFormatException($"Item {index} of \"{name}\" must be an object"));
    }

    private static string Text(JsonObject obj, string name, string where) =>
        obj[name] is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : throw new MapFormatException($"{where} needs a \"{name}\"");

    private static string? OptionalText(JsonObject obj, string name) =>
        obj[name] is JsonValue v && v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : null;

    private static OperatorNode ReadNode(JsonObject node)
    {
        var id = Text(node, "id", "A node");
        var constants = new Dictionary<int, JsonNode?>();
        if (node["constants"] is JsonObject values)
        {
            foreach (var (key, value) in values)
            {
                // Keys that aren't input indexes are kept as -1 so the analyser reports them.
                constants[int.TryParse(key, out var index) && index >= 0 ? index : -1 - constants.Count] = value;
            }
        }
        return new OperatorNode { Id = id, Operator = Text(node, "operator", $"Node \"{id}\""), Constants = constants, Scope = OptionalText(node, "scope") };
    }

    private static LinkEnd ReadEnd(JsonNode? end, string where)
    {
        if (end is not JsonObject obj) throw new MapFormatException($"{where} must be an object");
        // NumberIn reads every way a number can be held: parsed from text, or created in code as an int.
        int? input = Operators.Coerce.NumberIn(obj["input"]) is { } d && d == Math.Floor(d) && d <= int.MaxValue ? (int)d : null;
        if (obj["input"] is not null && input is null) input = -1;
        return new LinkEnd { Source = OptionalText(obj, "source"), Target = OptionalText(obj, "target"), Node = OptionalText(obj, "node"), Input = input };
    }

    private static Link ReadLink(JsonObject link, int index)
    {
        var from = ReadEnd(link["from"], $"Link {index}'s \"from\"");
        var to = ReadEnd(link["to"], $"Link {index}'s \"to\"");
        if (from.Source is null && from.Node is null) throw new MapFormatException($"Link {index} must come from a \"source\" or a \"node\"");
        if (to.Target is null && to.Node is null) throw new MapFormatException($"Link {index} must go to a \"target\" or a \"node\"");
        if (to.Node is not null && to.Target is null && to.Input is null) throw new MapFormatException($"Link {index} goes to node \"{to.Node}\" without an \"input\"");
        return new Link { From = from, To = to, Submap = OptionalText(link, "submap") };
    }


    private static Loop ReadLoop(JsonObject loop) => new()
    {
        Source = Text(loop, "source", "A loop"),
        Target = Text(loop, "target", "A loop"),
        SortBy = loop["sortBy"] is JsonArray keys
            ? keys.Select(key => key as JsonObject ?? throw new MapFormatException("A loop's sortBy entries must be objects"))
                .Select(key => new SortKey(Text(key, "path", "A sort key"), key["descending"] is JsonValue d && d.GetValueKind() == JsonValueKind.True))
                .ToList()
            : [],
        GroupBy = OptionalText(loop, "groupBy"),
        Distinct = loop["distinct"] is JsonValue distinct && distinct.GetValueKind() == JsonValueKind.True,
    };
}

/// <summary>Thrown when JSON isn't shaped like a map at all. A map that's shaped right but wrong is reported by <see cref="MapAnalyser"/> instead.</summary>
public sealed class MapFormatException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Where a field sits in XML, as OpenAPI's <c>xml</c> object says.</summary>
/// <param name="Name">The element or attribute name, where it differs from the field's.</param>
/// <param name="Namespace">The namespace, on the root.</param>
/// <param name="Prefix">A prefix to write it with.</param>
/// <param name="Attribute">An attribute rather than an element.</param>
/// <param name="Text">The text of the element it's in.</param>
/// <param name="Wrapped">For an array: its items sit inside an element of the array's name.</param>
public sealed record XmlHint(string? Name, string? Namespace, string? Prefix, bool Attribute, bool Text, bool Wrapped)
{
    internal static XmlHint FromJson(JsonObject xml)
    {
        static string? Text(JsonNode? node) => node is JsonValue value && value.GetValueKind() == JsonValueKind.String ? value.GetValue<string>() : null;
        static bool True(JsonNode? node) => node is JsonValue value && value.GetValueKind() == JsonValueKind.True;
        var nodeType = Text(xml["nodeType"]);
        return new(Text(xml["name"]), Text(xml["namespace"]), Text(xml["prefix"]), True(xml["attribute"]) || nodeType == "attribute", nodeType is "text" or "cdata", True(xml["wrapped"]));
    }
}

/// <summary>How a flat file is laid out (on the root schema) or where a column sits in one (on a row's field).</summary>
public sealed record FlatHint(
    string? Format,
    string? Delimiter,
    string? Quote,
    bool? Header,
    int Skip,
    string? LineEnding,
    string? Name,
    int? Width,
    string? Align,
    string? Pad,
    int Decimals,
    string? Tag = null,
    int? Count = null,
    string? Terminator = null,
    string? Release = null)
{
    internal static FlatHint FromJson(JsonObject flat)
    {
        static string? Text(JsonNode? node) => node is JsonValue value && value.GetValueKind() == JsonValueKind.String ? value.GetValue<string>() : null;
        static int? Whole(JsonNode? node) => node is JsonValue value && value.GetValueKind() == JsonValueKind.Number && value.TryGetValue<int>(out var n) ? n : null;
        static bool? Flag(JsonNode? node) => node is JsonValue value ? value.GetValueKind() switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null } : null;
        return new(Text(flat["format"]), Text(flat["delimiter"]), Text(flat["quote"]), Flag(flat["header"]), Whole(flat["skip"]) ?? 0, Text(flat["lineEnding"]), Text(flat["name"]), Whole(flat["width"]), Text(flat["align"]), Text(flat["pad"]), Whole(flat["decimals"]) ?? 0, Text(flat["tag"]), Whole(flat["count"]), Text(flat["terminator"]), Text(flat["release"]));
    }
}
