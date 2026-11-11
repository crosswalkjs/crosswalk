using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml;
using System.Xml.Linq;

namespace Crosswalk;

/// <summary>
/// XML at the edges. A map works on JSON, so XML is read into JSON before it runs and written
/// back out after, following the schema, exactly as the JavaScript runtime does:
/// <list type="bullet">
/// <item>The root element is the map's root record; its name and namespace are in the root schema's <c>xml</c>.</item>
/// <item>Child elements are fields, by local name. One the schema says repeats is an array.</item>
/// <item>Attributes are fields marked <c>xml: { attribute: true }</c>; an element's text beside attributes is a <c>#text</c> field.</item>
/// <item>Values take the schema's type: numbers, booleans, and text otherwise.</item>
/// </list>
/// A DOCTYPE is ignored and its entities never expanded, so documents from anywhere are safe to read.
/// </summary>
public static class XmlJson
{
    private static readonly XNamespace Xsi = "http://www.w3.org/2001/XMLSchema-instance";

    /// <summary>Reads an XML document into the JSON a map takes, following the schema. Without one, every value is text and an element that repeats is an array.</summary>
    public static JsonNode? Read(string xml, Schema? schema = null)
    {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Ignore, XmlResolver = null };
        using var reader = XmlReader.Create(new StringReader(xml), settings);
        var document = XDocument.Load(reader, LoadOptions.PreserveWhitespace);
        return ReadElement(document.Root ?? throw new MapFormatException("There's no root element"), schema);
    }

    private static IEnumerable<XAttribute> AttributesOf(XElement element) => element.Attributes().Where(a => !a.IsNamespaceDeclaration && a.Name.Namespace != Xsi);

    private static string TextOf(XElement element) => string.Concat(element.Nodes().OfType<XText>().Select(t => t.Value));

    private static JsonNode? ReadElement(XElement element, Schema? schema)
    {
        if ((string?)element.Attribute(Xsi + "nil") == "true") return null;
        var children = element.Elements().ToList();
        var attributes = AttributesOf(element).ToList();
        if (schema is not null ? schema.Type != "object" : children.Count == 0 && attributes.Count == 0) return Typed(TextOf(element), schema);

        var result = new JsonObject();
        if (schema is not null)
        {
            foreach (var (key, field) in schema.Properties)
            {
                var named = field.Xml?.Name ?? key;
                if (field.Xml?.Attribute == true)
                {
                    var attribute = attributes.FirstOrDefault(a => a.Name.LocalName == named);
                    if (attribute is not null) result[key] = Typed(attribute.Value, field);
                }
                else if (field.Xml?.Text == true)
                {
                    var text = TextOf(element);
                    if (text.Trim().Length > 0) result[key] = Typed(text, field);
                }
                else if (field.Type == "array")
                {
                    var itemName = field.Items?.Xml?.Name ?? named;
                    var holder = field.Xml?.Wrapped == true ? children.FirstOrDefault(c => c.Name.LocalName == named) : element;
                    if (holder is null) continue;
                    var items = holder.Elements().Where(c => c.Name.LocalName == itemName).ToList();
                    if (items.Count > 0 || field.Xml?.Wrapped == true) result[key] = new JsonArray([.. items.Select(item => ReadElement(item, field.Items))]);
                }
                else
                {
                    var child = children.FirstOrDefault(c => c.Name.LocalName == named);
                    if (child is not null) result[key] = ReadElement(child, field);
                }
            }
            return result;
        }
        foreach (var attribute in attributes) result[attribute.Name.LocalName] = attribute.Value;
        foreach (var group in children.GroupBy(c => c.Name.LocalName))
        {
            var matching = group.ToList();
            result[group.Key] = matching.Count > 1 ? new JsonArray([.. matching.Select(c => ReadElement(c, null))]) : ReadElement(matching[0], null);
        }
        var own = TextOf(element).Trim();
        if (own.Length > 0) result["#text"] = own;
        return result;
    }

    /// <summary>A field's text as the schema's type says; text it can't read as that type stays text.</summary>
    private static JsonNode? Typed(string text, Schema? schema)
    {
        var value = text.Trim();
        switch (schema?.Type)
        {
            case "integer":
            case "number":
                if (value.Length > 0 && double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && double.IsFinite(number))
                {
                    return number == Math.Floor(number) && Math.Abs(number) < 9007199254740992 ? JsonValue.Create((long)number) : JsonValue.Create(number);
                }
                return JsonValue.Create(text);
            case "boolean":
                return value is "true" or "1" ? JsonValue.Create(true) : value is "false" or "0" ? JsonValue.Create(false) : JsonValue.Create(text);
            default:
                return JsonValue.Create(text);
        }
    }

    /// <summary>
    /// Writes what a map made as XML, following the target schema: attributes, elements in the schema's order,
    /// repeated elements for arrays, and the root's name and namespace from its <c>xml</c>. A field that's
    /// left out, or null, writes nothing.
    /// </summary>
    /// <param name="value">What the map made.</param>
    /// <param name="schema">The map's target schema.</param>
    /// <param name="root">The root element's name, where the schema's <c>xml.name</c> doesn't give one. Defaults to its title, or <c>root</c>.</param>
    /// <param name="indent">Spaces to indent by, or 0 for one line.</param>
    /// <param name="declaration">Whether to start with the XML declaration.</param>
    public static string Write(JsonNode? value, Schema? schema = null, string? root = null, int indent = 2, bool declaration = true)
    {
        var lines = new List<string>();
        var newline = indent > 0 ? "\n" : "";
        string Pad(int depth) => indent > 0 ? new string(' ', indent * depth) : "";
        static string Qualified(string name, Schema? field) => field?.Xml?.Prefix is { } prefix ? $"{prefix}:{name}" : name;

        void WriteElement(string name, JsonNode? data, Schema? field, int depth, string declare = "")
        {
            if (data is null) return;
            if (data is JsonArray array)
            {
                foreach (var item in array) WriteElement(name, item, field?.Items, depth);
                return;
            }
            if (data is not JsonObject obj)
            {
                lines.Add($"{Pad(depth)}<{name}{declare}>{EscapeText(AsText(data))}</{name}>");
                return;
            }
            var properties = field?.Type == "object" ? field.Properties : [];
            Schema? PropertyOf(string key) => properties.FirstOrDefault(p => p.Key == key).Value;
            var keys = properties.Select(p => p.Key).Where(obj.ContainsKey).Concat(obj.Select(p => p.Key).Where(k => PropertyOf(k) is null)).ToList();
            var attributes = new StringBuilder();
            string? text = null;
            var elements = new List<(string Key, JsonNode Value, Schema? Field)>();
            foreach (var key in keys)
            {
                var inner = obj[key];
                var sub = PropertyOf(key);
                if (inner is null) continue;
                if (sub?.Xml?.Attribute == true || (sub is null && key.StartsWith('@'))) attributes.Append($" {Qualified(sub?.Xml?.Name ?? key.TrimStart('@'), sub)}=\"{EscapeAttribute(AsText(inner))}\"");
                else if (sub?.Xml?.Text == true || (sub is null && key == "#text")) text = AsText(inner);
                else elements.Add((key, inner, sub));
            }
            if (elements.Count == 0)
            {
                lines.Add(text is null ? $"{Pad(depth)}<{name}{declare}{attributes}/>" : $"{Pad(depth)}<{name}{declare}{attributes}>{EscapeText(text)}</{name}>");
                return;
            }
            lines.Add($"{Pad(depth)}<{name}{declare}{attributes}>{(text is null ? "" : EscapeText(text))}");
            foreach (var (key, inner, sub) in elements)
            {
                var elementName = Qualified(sub?.Xml?.Name ?? key, sub);
                if (inner is JsonArray items && sub?.Xml?.Wrapped == true)
                {
                    lines.Add($"{Pad(depth + 1)}<{elementName}>");
                    foreach (var item in items) WriteElement(Qualified(sub.Items?.Xml?.Name ?? key, sub.Items), item, sub.Items, depth + 2);
                    lines.Add($"{Pad(depth + 1)}</{elementName}>");
                }
                else if (inner is JsonArray list)
                {
                    foreach (var item in list) WriteElement(Qualified(sub?.Items?.Xml?.Name ?? elementName, sub?.Items), item, sub?.Items, depth + 1);
                }
                else WriteElement(elementName, inner, sub, depth + 1);
            }
            lines.Add($"{Pad(depth)}</{name}>");
        }

        var hint = schema?.Xml;
        var rootName = hint?.Name ?? root ?? (schema?.Title is { } title ? new string([.. title.Where(c => char.IsLetterOrDigit(c) || c is '_' or '.' or '-')]) : null) ?? "root";
        var declareNamespace = hint?.Namespace is { } ns ? hint.Prefix is { } p ? $" xmlns:{p}=\"{EscapeAttribute(ns)}\"" : $" xmlns=\"{EscapeAttribute(ns)}\"" : "";
        WriteElement(hint?.Prefix is { } rootPrefix ? $"{rootPrefix}:{rootName}" : rootName, value, schema, 0, declareNamespace);
        return $"{(declaration ? $"<?xml version=\"1.0\" encoding=\"UTF-8\"?>{newline}" : "")}{string.Join(newline, lines)}{newline}";
    }

    private static string AsText(JsonNode node) => node.GetValueKind() == JsonValueKind.String ? node.GetValue<string>() : Operators.Coerce.ToText(Value.Of(node));

    private static string EscapeText(string text) => text.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");

    private static string EscapeAttribute(string text) => EscapeText(text).Replace("\"", "&quot;");
}
