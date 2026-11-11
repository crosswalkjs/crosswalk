using System.Collections.Concurrent;

namespace Crosswalk;

/// <summary>
/// Field paths such as <c>PhoneCalls[].Cost</c>: object keys joined with <c>.</c>, a
/// repeating field written with <c>[]</c>, and a <c>\</c> escaping the next character, for
/// keys that contain <c>.</c>, <c>[</c> or <c>]</c>.
/// </summary>
internal static partial class Paths
{
    internal readonly record struct Segment(string Key, bool Array);

    private static readonly ConcurrentDictionary<string, Segment[]> Parsed = new();

    public static Segment[] Parse(string path) => Parsed.GetOrAdd(path, static p => Split(p));

    private static Segment[] Split(string path)
    {
        var segments = new List<Segment>();
        if (path.Length == 0) return [];
        MapFormatException Invalid() => new($"Invalid path \"{path}\"");
        var key = new System.Text.StringBuilder();
        var array = false;
        void End()
        {
            if (key.Length == 0) throw Invalid();
            segments.Add(new Segment(key.ToString(), array));
            key.Clear();
            array = false;
        }
        for (var i = 0; i <= path.Length; i++)
        {
            if (i == path.Length || path[i] == '.') End();
            // Only a `.` or the end may follow `[]`.
            else if (array) throw Invalid();
            else if (path[i] == '\\')
            {
                if (++i == path.Length) throw Invalid();
                key.Append(path[i]);
            }
            else if (path[i] == '[')
            {
                if (++i == path.Length || path[i] != ']') throw Invalid();
                array = true;
            }
            else if (path[i] == ']') throw Invalid();
            else key.Append(path[i]);
        }
        return [.. segments];
    }

    /// <summary>A key as it's written in a path, with <c>.</c>, <c>[</c>, <c>]</c> and <c>\</c> escaped by a <c>\</c>.</summary>
    public static string EscapeKey(string key) => Escapable().Replace(key, @"\$0");

    [System.Text.RegularExpressions.GeneratedRegex(@"[\\.\[\]]")]
    private static partial System.Text.RegularExpressions.Regex Escapable();

    /// <summary>The path of a property, with <c>[]</c> added when it's an array.</summary>
    public static string Child(string parent, string key, Schema schema)
    {
        var path = parent.Length == 0 ? EscapeKey(key) : $"{parent}.{EscapeKey(key)}";
        return schema.Type == "array" ? path + "[]" : path;
    }

    /// <summary>The repeating fields a path passes through, outermost first: <c>A[].B[].c</c> gives <c>A[]</c> and <c>A[].B[]</c>.</summary>
    public static List<string> ArrayScopes(string path)
    {
        var scopes = new List<string>();
        var prefix = "";
        foreach (var segment in Parse(path))
        {
            prefix = prefix.Length == 0 ? EscapeKey(segment.Key) : $"{prefix}.{EscapeKey(segment.Key)}";
            if (!segment.Array) continue;
            prefix += "[]";
            scopes.Add(prefix);
        }
        return scopes;
    }

    /// <summary>The schema at a path, or null when the path isn't in the schema. <c>X[]</c> gives the item schema.</summary>
    public static Schema? SchemaAt(Schema root, string path)
    {
        Segment[] segments;
        try
        {
            segments = Parse(path);
        }
        catch (MapFormatException)
        {
            return null;
        }
        Schema? current = root;
        foreach (var segment in segments)
        {
            current = current?.Type == "object" ? current.Property(segment.Key) : null;
            if (current is null) return null;
            if (segment.Array != (current.Type == "array")) return null;
            if (segment.Array) current = current.Items;
        }
        return current;
    }

    /// <summary>True for a schema holding a single value rather than an object or array.</summary>
    public static bool IsValue(Schema schema) => schema.Type is not "object" and not "array";
}
