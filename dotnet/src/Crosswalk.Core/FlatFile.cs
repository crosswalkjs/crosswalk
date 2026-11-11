using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Crosswalk;

/// <summary>
/// Flat files at the edges: CSV and fixed-width text, read into JSON before a map runs and written back
/// after, following the schema, exactly as the JavaScript runtime does. The file is the root record, with
/// one array field (the first in the root schema, or <c>rows</c>) holding a record per line; the root's
/// <c>flat</c> says how the file is laid out, and each column's <c>flat</c> where it sits.
/// </summary>
public static partial class FlatFile
{
    [GeneratedRegex(@"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")]
    private static partial Regex Decimal();

    [GeneratedRegex(@"\r?\n")]
    private static partial Regex LineBreak();

    /// <summary>The tag a field's lines start with, if it's one of a file's kinds of line: on the field, or on an array's items.</summary>
    private static string? TagOf(Schema? field) => field?.Flat?.Tag ?? field?.Items?.Flat?.Tag;

    /// <summary>The record a kind of line holds.</summary>
    private static Schema? RecordOf(Schema field) => field.Type == "array" ? field.Items : field;

    /// <summary>A record's columns: its fields that aren't kinds of line of their own.</summary>
    private static List<(string Name, Schema? Column)> ColumnsOf(Schema? record) => [.. (record?.Properties ?? []).Where(p => TagOf(p.Value) is null).Select(p => (p.Key, (Schema?)p.Value))];

    /// <summary>The kinds of line a record holds.</summary>
    private static List<KeyValuePair<string, Schema>> KindsOf(Schema? record) => [.. (record?.Properties ?? []).Where(p => TagOf(p.Value) is not null)];

    private static (string Key, Schema? Row) RowsOf(Schema? schema)
    {
        foreach (var (key, field) in schema?.Properties ?? [])
        {
            if (field.Type == "array") return (key, field.Items);
        }
        return ("rows", null);
    }

    /// <summary>
    /// Splits CSV text into lines of fields, as RFC 4180 has it. With a terminator, as EDI has, lines end there instead,
    /// and line breaks after it are skipped. A release character keeps the one after it, still released, for the field's
    /// reader to split by and then take as itself.
    /// </summary>
    private static List<List<string>> ParseCsv(string text, string delimiter, string quote, string? terminator = null, string? release = null)
    {
        var rows = new List<List<string>>();
        var row = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        var i = 0;
        void End()
        {
            row.Add(field.ToString());
            field.Clear();
        }
        while (i < text.Length)
        {
            var c = text[i];
            if (quoted)
            {
                if (At(text, i, quote) && At(text, i + quote.Length, quote))
                {
                    field.Append(quote);
                    i += quote.Length * 2;
                }
                else if (At(text, i, quote))
                {
                    quoted = false;
                    i += quote.Length;
                }
                else
                {
                    field.Append(c);
                    i++;
                }
            }
            else if (!string.IsNullOrEmpty(release) && At(text, i, release) && i + release.Length < text.Length)
            {
                field.Append(text, i, release.Length + 1);
                i += release.Length + 1;
            }
            else if (field.Length == 0 && At(text, i, quote))
            {
                quoted = true;
                i += quote.Length;
            }
            else if (At(text, i, delimiter))
            {
                End();
                i += delimiter.Length;
            }
            else if (!string.IsNullOrEmpty(terminator) && At(text, i, terminator))
            {
                End();
                rows.Add(row);
                row = [];
                i += terminator.Length;
                while (i < text.Length && text[i] is '\r' or '\n') i++;
            }
            else if (string.IsNullOrEmpty(terminator) && c is '\r' or '\n')
            {
                End();
                rows.Add(row);
                row = [];
                i += c == '\r' && i + 1 < text.Length && text[i + 1] == '\n' ? 2 : 1;
            }
            else
            {
                field.Append(c);
                i++;
            }
        }
        if (quoted) throw new MapFormatException($"A quoted field isn't closed (line {rows.Count + 1})");
        if (field.Length > 0 || row.Count > 0)
        {
            End();
            rows.Add(row);
        }
        return rows;
    }

    /// <summary>A field's text as its schema's type says; text that doesn't read as that type stays text. Empty is left out (null here).</summary>
    private static JsonNode? Typed(string text, Schema? schema, bool fixedWidth, out bool present)
    {
        var value = text.Trim();
        present = value.Length > 0;
        if (!present) return null;
        JsonNode Text() => JsonValue.Create(fixedWidth ? value : text);
        switch (schema?.Type)
        {
            case "integer":
            case "number":
                if (!Decimal().IsMatch(value) || !double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) || !double.IsFinite(number)) return Text();
                if (fixedWidth && schema.Flat?.Decimals is > 0 and var decimals) number /= Math.Pow(10, decimals);
                return number == Math.Floor(number) && Math.Abs(number) < 9007199254740992 ? JsonValue.Create((long)number) : JsonValue.Create(number);
            case "boolean":
                var lower = value.ToLowerInvariant();
                return lower is "true" or "1" ? JsonValue.Create(true) : lower is "false" or "0" ? JsonValue.Create(false) : Text();
            default:
                return Text();
        }
    }

    /// <summary>
    /// Reads a CSV or fixed-width file into the JSON a map takes, following the schema. Without a schema it
    /// reads CSV with a header row, every value as text.
    /// </summary>
    public static JsonObject Read(string text, Schema? schema = null)
    {
        // A file with several kinds of line, each told apart by its tag.
        if (KindsOf(schema).Count > 0) return ReadKinds(text.StartsWith('\ufeff') ? text[1..] : text, schema!);
        var hint = schema?.Flat;
        var (key, row) = RowsOf(schema);
        List<(string Name, Schema? Column)> columns = [.. (row?.Properties ?? []).Select(p => (p.Key, (Schema?)p.Value))];
        var fixedWidth = hint?.Format == "fixed";
        var body = text.StartsWith('﻿') ? text[1..] : text;
        var records = new JsonArray();
        var escapes = new Escapes(hint?.Release, []);

        if (fixedWidth)
        {
            var lines = FixedLines(body, hint).Skip(hint!.Skip).Skip(hint.Header == true ? 1 : 0);
            foreach (var line in lines)
                if (line.Trim().Length > 0) records.Add((JsonNode)ReadFixed(line, 0, columns));
            return new JsonObject { [key] = records };
        }

        var all = ParseCsv(body, hint?.Delimiter ?? ",", QuoteOf(hint), hint?.Terminator, hint?.Release)
            .Skip(hint?.Skip ?? 0)
            .Where(line => !(line.Count == 1 && line[0].Trim().Length == 0))
            .ToList();
        var header = hint?.Header ?? true;
        var headings = new List<string>();
        if (header && all.Count > 0)
        {
            headings = [.. all[0].Select(h => h.Trim())];
            all.RemoveAt(0);
        }
        // Each column of the schema finds its field by its header name, or, without a header, by its place.
        if (columns.Count > 0)
        {
            foreach (var line in all) records.Add((JsonNode)ReadCsv(line, columns, escapes, header ? headings : null));
            return new JsonObject { [key] = records };
        }
        var places = (header ? headings : (all.FirstOrDefault() ?? []).Select((_, i) => $"column{i + 1}").ToList()).Select((name, index) => (Name: name, Column: (Schema?)null, At: index)).ToList();
        foreach (var line in all)
        {
            var record = new JsonObject();
            foreach (var (name, column, at) in places)
            {
                if (at < 0) continue;
                var value = Typed(at < line.Count ? line[at] : "", column, false, out var present);
                if (present) record[name] = value;
            }
            records.Add((JsonNode)record);
        }
        return new JsonObject { [key] = records };
    }

    /// <summary>EDI has no quotes, so a file with a terminator or release character quotes nothing unless it says so.</summary>
    private static string QuoteOf(FlatHint? hint) => hint?.Quote ?? (hint?.Terminator is not null || hint?.Release is not null ? "" : "\"");

    /// <summary>A fixed-width file's lines: at its terminator, if it has one, else at line breaks.</summary>
    private static string[] FixedLines(string body, FlatHint? hint) =>
        string.IsNullOrEmpty(hint?.Terminator) ? LineBreak().Split(body) : [.. body.Split(hint.Terminator).Select(line => line.TrimStart('\r', '\n'))];

    private sealed record Line(int Number, Func<string, bool> Starts, Func<Schema?, string, JsonObject> Fields);

    private static JsonObject ReadKinds(string body, Schema schema)
    {
        var hint = schema.Flat;
        var lines = new List<Line>();
        var escapes = new Escapes(hint?.Release, []);
        if (hint?.Format == "fixed")
        {
            var all = FixedLines(body, hint);
            for (var index = 0; index < all.Length; index++)
            {
                var line = all[index];
                if (index < (hint.Skip) || line.Trim().Length == 0) continue;
                // The columns start after the tag.
                lines.Add(new Line(index + 1, tag => line.StartsWith(tag, StringComparison.Ordinal), (record, tag) => ReadFixed(line, tag.Length, ColumnsOf(record))));
            }
        }
        else
        {
            var rows = ParseCsv(body, hint?.Delimiter ?? ",", QuoteOf(hint), hint?.Terminator, hint?.Release);
            for (var index = 0; index < rows.Count; index++)
            {
                var row = rows[index];
                if (index < (hint?.Skip ?? 0) || row.All(cell => cell.Trim().Length == 0)) continue;
                lines.Add(new Line(index + 1, tag => row.Count > 0 && row[0].Trim() == tag, (record, _) => ReadCsv([.. row.Skip(1)], ColumnsOf(record), escapes)));
            }
        }
        var at = 0;
        // Reads the lines that belong to a record: those of its own kinds, each with the lines of its kinds after it.
        void ReadLevel(Schema? record, JsonObject into)
        {
            while (at < lines.Count)
            {
                var line = lines[at];
                var match = KindsOf(record).FirstOrDefault(k => line.Starts(TagOf(k.Value)!));
                if (match.Key is null) return;
                var (name, kind) = match;
                // A second line of a single record belongs to the next record up.
                if (kind.Type != "array" && into.ContainsKey(name)) return;
                at++;
                var item = line.Fields(RecordOf(kind), TagOf(kind)!);
                ReadLevel(RecordOf(kind), item);
                if (kind.Type == "array")
                {
                    if (into[name] is not JsonArray list) into[name] = list = [];
                    list.Add((JsonNode)item);
                }
                else into[name] = item;
            }
        }
        var root = new JsonObject();
        ReadLevel(schema, root);
        if (at < lines.Count) throw new MapFormatException($"Line {lines[at].Number} isn't a kind of line this file has, or isn't where one belongs");
        return root;
    }

    /// <summary>A CSV field, quoted when it holds the delimiter, a quote or a line break, or starts or ends with white space.</summary>
    private static string CsvField(string text, string delimiter, string quote) =>
        quote.Length > 0 && (text.Contains(delimiter) || text.Contains(quote) || text.Contains('\r') || text.Contains('\n') || (text.Length > 0 && (char.IsWhiteSpace(text[0]) || char.IsWhiteSpace(text[^1]))))
            ? quote + text.Replace(quote, quote + quote) + quote
            : text;

    /// <summary>A fixed-width cell: padded to its width, a number with implied decimals multiplied out, and too wide an error.</summary>
    private static string FixedCell(string name, Schema? column, JsonNode? data)
    {
        var flat = column?.Flat;
        var width = flat?.Width is > 0 and var w ? w : throw new MapFormatException($"Column \"{name}\" needs a width: a fixed-width file's columns each have flat.width");
        var numeric = column?.Type is "number" or "integer";
        var text = "";
        if (data is not null)
        {
            if (numeric && data.GetValueKind() == JsonValueKind.Number && flat!.Decimals > 0)
            {
                // Rounded as JavaScript's Math.round does: halves up.
                var scaled = Math.Floor(data.GetValue<double>() * Math.Pow(10, flat.Decimals) + 0.5);
                text = Operators.Coerce.NumberToText(scaled);
            }
            else text = AsText(data);
        }
        if (text.Length > width) throw new MapFormatException($"\"{text}\" is too wide for column \"{name}\", which takes {width}");
        var pad = string.IsNullOrEmpty(flat!.Pad) ? ' ' : flat.Pad[0];
        var right = (flat.Align ?? (numeric ? "right" : "left")) == "right";
        if (right && pad == '0' && text.StartsWith('-')) return "-" + text[1..].PadLeft(width - 1, '0');
        return right ? text.PadLeft(width, pad) : text.PadRight(width, pad);
    }

    /// <summary>A file with several kinds of line: each record's line, then the lines of the kinds it holds, in the schema's order.</summary>
    private static string WriteKinds(JsonNode? value, Schema schema)
    {
        var hint = schema.Flat;
        var delimiter = hint?.Delimiter ?? ",";
        var quote = QuoteOf(hint);
        var lines = new List<string>();
        var escapes = EscapesFor(schema);
        string Field(string text) => hint?.Release is not null ? text : CsvField(text, delimiter, quote);
        string LineFor(string tag, Schema? record, JsonObject item) =>
            hint?.Format == "fixed"
                ? tag + WriteFixed(ColumnsOf(record), item)
                : string.Join(delimiter, new[] { Field(tag) }.Concat(Ends(hint, WriteCsv(ColumnsOf(record), item, Field, false, escapes))));
        void WriteLevel(Schema? record, JsonObject data)
        {
            foreach (var (name, kind) in KindsOf(record))
            {
                var inner = data[name];
                var many = inner is JsonArray list ? list.ToList() : inner is not null ? [inner] : [];
                foreach (var item in many.OfType<JsonObject>())
                {
                    lines.Add(LineFor(TagOf(kind)!, RecordOf(kind), item));
                    WriteLevel(RecordOf(kind), item);
                }
            }
        }
        if (value is JsonObject top) WriteLevel(schema, top);
        var newline = NewlineOf(hint);
        return lines.Count > 0 ? string.Join(newline, lines) + newline : "";
    }

    /// <summary>A column that repeats within a line: an array that isn't a kind of line.</summary>
    private static bool IsGroup(Schema? field) => field?.Type == "array" && TagOf(field) is null;

    /// <summary>A column that's a record of parts: an object that isn't a kind of line.</summary>
    private static bool IsComposite(Schema? field) => field?.Type == "object" && TagOf(field) is null && field.Properties is { Count: > 0 };

    private static int WidthOf(string name, Schema? column) =>
        column?.Flat?.Width is > 0 and var width ? width : throw new MapFormatException($"Column \"{name}\" needs a width: a fixed-width file's columns each have flat.width");

    /// <summary>The items of a group to write, nulls left out.</summary>
    private static List<JsonNode> ListOf(JsonNode? value) => value is JsonArray list ? [.. list.OfType<JsonNode>()] : [];

    private static bool IsEmpty(JsonNode? value) => value is null || value is JsonObject { Count: 0 };

    /// <summary>How a CSV file's values are escaped: EDIFACT's release character, and the characters it releases.</summary>
    private sealed record Escapes(string? Release, List<string> Specials);

    private static bool At(string text, int i, string what) => what.Length > 0 && string.CompareOrdinal(text, i, what, 0, what.Length) == 0;

    /// <summary>Splits text at a separator, except where the release character comes before it.</summary>
    private static List<string> SplitAt(string text, string separator, string? release)
    {
        if (string.IsNullOrEmpty(release)) return [.. text.Split(separator)];
        var pieces = new List<string>();
        var piece = new StringBuilder();
        for (var i = 0; i < text.Length; i++)
        {
            if (At(text, i, release) && i + release.Length < text.Length)
            {
                piece.Append(text, i, release.Length + 1);
                i += release.Length;
            }
            else if (At(text, i, separator))
            {
                pieces.Add(piece.ToString());
                piece.Clear();
                i += separator.Length - 1;
            }
            else piece.Append(text[i]);
        }
        pieces.Add(piece.ToString());
        return pieces;
    }

    /// <summary>Text with each released character as itself.</summary>
    private static string Unescape(string text, string? release)
    {
        if (string.IsNullOrEmpty(release)) return text;
        var result = new StringBuilder();
        for (var i = 0; i < text.Length; i++)
        {
            if (At(text, i, release) && i + release.Length < text.Length) i += release.Length;
            result.Append(text[i]);
        }
        return result.ToString();
    }

    /// <summary>Text with each separator in it released, so it reads back as itself.</summary>
    private static string Escape(string text, Escapes escapes)
    {
        if (string.IsNullOrEmpty(escapes.Release)) return text;
        var result = new StringBuilder();
        for (var i = 0; i < text.Length; i++)
        {
            var special = escapes.Specials.FirstOrDefault(s => At(text, i, s));
            if (special is not null)
            {
                result.Append(escapes.Release).Append(special);
                i += special.Length - 1;
            }
            else result.Append(text[i]);
        }
        return result.ToString();
    }

    /// <summary>Every separator a schema uses, in the order it has them, for releasing in values.</summary>
    private static List<string> SeparatorsOf(Schema? schema, List<string> into)
    {
        foreach (var s in new[] { schema?.Flat?.Delimiter, schema?.Flat?.Terminator, schema?.Flat?.Release })
            if (!string.IsNullOrEmpty(s) && !into.Contains(s)) into.Add(s);
        foreach (var (_, inner) in schema?.Properties ?? []) SeparatorsOf(inner, into);
        if (schema?.Items is { } items) SeparatorsOf(items, into);
        return into;
    }

    /// <summary>What splits a field into a record's parts, or a group's items.</summary>
    private static string SplitterOf(string name, Schema column) =>
        column.Flat?.Delimiter ?? throw new MapFormatException(IsGroup(column)
            ? $"Repeating group \"{name}\" is inside a field, so it needs a flat.delimiter to split it into its items"
            : $"Column \"{name}\" is a record, so it needs a flat.delimiter to split its field into its parts");

    /// <summary>A value within one CSV field: a record split into its parts, a group into its items, each of those as deep as its schema goes.</summary>
    private static JsonNode? ReadField(string name, Schema? schema, string text, Escapes escapes)
    {
        if (IsComposite(schema))
        {
            var pieces = SplitAt(text, SplitterOf(name, schema!), escapes.Release);
            var record = new JsonObject();
            var index = 0;
            foreach (var (part, inner) in schema!.Properties!)
            {
                if (ReadField(part, inner, index < pieces.Count ? pieces[index] : "", escapes) is { } value) record[part] = value;
                index++;
            }
            return record.Count > 0 ? record : null;
        }
        if (IsGroup(schema))
        {
            var list = new JsonArray();
            foreach (var piece in SplitAt(text, SplitterOf(name, schema!), escapes.Release))
                if (ReadField(name, schema!.Items, piece, escapes) is { } item && !IsEmpty(item)) list.Add((JsonNode)item);
            return list.Count > 0 ? list : null;
        }
        // A CSV value with a width is padded to it, as X12's envelope is, so it's trimmed as fixed-width values are.
        var typed = Typed(Unescape(text, escapes.Release), schema, schema?.Flat?.Width is not null, out var present);
        return present ? typed : null;
    }

    /// <summary>A value within one CSV field as text, released where it holds a separator; empty when there's nothing in it.</summary>
    private static string WriteField(string name, Schema? schema, JsonNode? value, Escapes escapes)
    {
        if (IsComposite(schema))
        {
            var parts = schema!.Properties!.Select(p => WriteField(p.Key, p.Value, value is JsonObject record ? record[p.Key] : null, escapes)).ToList();
            // Empty parts at the end are left off, as HL7 and EDI have it.
            return string.Join(SplitterOf(name, schema), WithoutTrailing(parts));
        }
        if (IsGroup(schema))
        {
            var separator = SplitterOf(name, schema!);
            return string.Join(separator, ListOf(value).Select(item => WriteField(name, schema!.Items, item, escapes)));
        }
        if (schema?.Flat?.Width is not null)
            return FixedCell(name, schema, value is JsonValue text && text.GetValueKind() == JsonValueKind.String ? JsonValue.Create(Escape(text.GetValue<string>(), escapes)) : value);
        return value is null ? "" : Escape(AsText(value), escapes);
    }

    /// <summary>Values without the empty ones at the end.</summary>
    private static List<string> WithoutTrailing(List<string> values)
    {
        var end = values.Count;
        while (end > 0 && values[end - 1].Length == 0) end--;
        return values.GetRange(0, end);
    }

    /// <summary>How many characters a fixed-width value takes: a column's width, a record's parts', or a group's slots.</summary>
    private static int FixedWidthOf(string name, Schema? schema)
    {
        if (IsComposite(schema)) return schema!.Properties!.Sum(p => FixedWidthOf(p.Key, p.Value));
        if (IsGroup(schema))
        {
            var count = schema!.Flat?.Count ?? throw new MapFormatException($"Repeating group \"{name}\" is inside another value, so it needs a flat.count: only a column can take the rest of the line");
            return count * FixedWidthOf(name, schema.Items);
        }
        return WidthOf(name, schema);
    }

    private static string Slice(string line, int at, int width) => at >= line.Length ? "" : line.Substring(at, Math.Min(width, line.Length - at));

    /// <summary>A fixed-width value at <paramref name="at"/>: a column, a record's parts one after another, or a group's slots.</summary>
    private static JsonNode? ReadFixedValue(string name, Schema? schema, string line, int at)
    {
        if (IsComposite(schema))
        {
            var record = new JsonObject();
            foreach (var (part, inner) in schema!.Properties!)
            {
                if (ReadFixedValue(part, inner, line, at) is { } value) record[part] = value;
                at += FixedWidthOf(part, inner);
            }
            return record.Count > 0 ? record : null;
        }
        if (IsGroup(schema))
        {
            var slot = FixedWidthOf(name, schema!.Items);
            var list = new JsonArray();
            for (var n = 0; n < schema.Flat!.Count!.Value; n++)
                if (ReadFixedValue(name, schema.Items, line, at + n * slot) is { } item && !IsEmpty(item)) list.Add((JsonNode)item);
            return list.Count > 0 ? list : null;
        }
        var typed = Typed(Slice(line, at, WidthOf(name, schema)), schema, true, out var present);
        return present ? typed : null;
    }

    /// <summary>A fixed-width value as text: a column's cell, a record's parts, or a group's items then blank slots up to its count.</summary>
    private static string WriteFixedValue(string name, Schema? schema, JsonNode? value)
    {
        if (IsComposite(schema)) return string.Concat(schema!.Properties!.Select(p => WriteFixedValue(p.Key, p.Value, value is JsonObject record ? record[p.Key] : null)));
        if (IsGroup(schema))
        {
            var list = ListOf(value);
            var count = schema!.Flat?.Count;
            if (count is not null && list.Count > count) throw new MapFormatException($"\"{name}\" has {list.Count} items, more than the {count} its line has room for");
            var blank = new string(' ', FixedWidthOf(name, schema.Items));
            return string.Concat(list.Select(item => WriteFixedValue(name, schema.Items, item))) + string.Concat(Enumerable.Repeat(blank, Math.Max(0, (count ?? 0) - list.Count)));
        }
        return FixedCell(name, schema, value);
    }

    /// <summary>A group that takes the rest of the line has to come last. In CSV, one with a delimiter of its own takes one field, so can go anywhere.</summary>
    private static void CheckGroups(List<(string Name, Schema? Column)> columns, bool fixedWidth)
    {
        for (var index = 0; index < columns.Count - 1; index++)
        {
            var (name, column) = columns[index];
            if (!IsGroup(column) || column!.Flat?.Count is not null || (!fixedWidth && column.Flat?.Delimiter is not null)) continue;
            throw new MapFormatException($"Repeating group \"{name}\" takes the rest of the line, so it has to be the last column, or have a flat.count");
        }
    }

    /// <summary>A fixed-width line's columns, from <paramref name="at"/>; a group without a count takes slots to the end of the line.</summary>
    private static JsonObject ReadFixed(string line, int at, List<(string Name, Schema? Column)> columns)
    {
        CheckGroups(columns, true);
        var record = new JsonObject();
        foreach (var (name, column) in columns)
        {
            if (IsGroup(column) && column!.Flat?.Count is null)
            {
                var slot = FixedWidthOf(name, column.Items);
                var list = new JsonArray();
                for (; at < line.Length; at += slot)
                    if (ReadFixedValue(name, column.Items, line, at) is { } item && !IsEmpty(item)) list.Add((JsonNode)item);
                if (list.Count > 0) record[name] = list;
                continue;
            }
            if (ReadFixedValue(name, column, line, at) is { } value) record[name] = value;
            at += FixedWidthOf(name, column);
        }
        return record;
    }

    /// <summary>The parts of a group's items, for a group spread over fields: their fields, or the item itself (no name) when it's a single value.</summary>
    private static List<(string? Name, Schema? Column)> PartsOfItem(Schema? item) =>
        IsComposite(item) && item!.Flat?.Delimiter is null ? [.. item.Properties!.Select(p => ((string?)p.Key, (Schema?)p.Value))] : [(null, item)];

    /// <summary>A CSV line's columns: by heading where there's a header, otherwise by place, a group taking one field or the fields that follow.</summary>
    private static JsonObject ReadCsv(IReadOnlyList<string> values, List<(string Name, Schema? Column)> columns, Escapes escapes, List<string>? headings = null)
    {
        CheckGroups(columns, false);
        var record = new JsonObject();
        var at = 0;
        foreach (var (name, column) in columns)
        {
            var hint = column?.Flat;
            var place = headings is not null ? headings.IndexOf(hint?.Name ?? name) : at;
            if (!IsGroup(column) || hint?.Delimiter is not null)
            {
                at++;
                if (place >= 0 && ReadField(name, column, place < values.Count ? values[place] : "", escapes) is { } value) record[name] = value;
                continue;
            }
            // Items in the fields that follow, each part of an item a field of its own.
            if (headings is not null) throw new MapFormatException($"Repeating group \"{name}\" needs a flat.delimiter in a CSV file with a header, so its items share one field");
            var parts = PartsOfItem(column!.Items);
            var list = new JsonArray();
            for (var n = 0; hint?.Count is not { } count ? at < values.Count : n < count; n++)
            {
                var fields = values.Skip(at).Take(parts.Count).ToList();
                at += parts.Count;
                JsonNode? item;
                if (parts[0].Name is null) item = ReadField(name, parts[0].Column, fields.Count > 0 ? fields[0] : "", escapes);
                else
                {
                    var inner = new JsonObject();
                    for (var index = 0; index < parts.Count; index++)
                        if (ReadField(parts[index].Name!, parts[index].Column, index < fields.Count ? fields[index] : "", escapes) is { } part) inner[parts[index].Name!] = part;
                    item = inner;
                }
                if (!IsEmpty(item)) list.Add((JsonNode)item!);
            }
            if (list.Count > 0) record[name] = list;
        }
        return record;
    }

    /// <summary>A fixed-width line's columns as text.</summary>
    private static string WriteFixed(List<(string Name, Schema? Column)> columns, JsonObject item)
    {
        CheckGroups(columns, true);
        return string.Concat(columns.Select(c => WriteFixedValue(c.Name, c.Column, item[c.Name])));
    }

    /// <summary>A CSV line's cells: each column's field, or a group's items in the fields that follow, empty ones up to its count.</summary>
    private static List<string> WriteCsv(List<(string Name, Schema? Column)> columns, JsonObject item, Func<string, string> field, bool header, Escapes escapes)
    {
        CheckGroups(columns, false);
        string Cell(string text) => text.Length == 0 ? "" : field(text);
        var cells = new List<string>();
        foreach (var (name, column) in columns)
        {
            var hint = column?.Flat;
            if (!IsGroup(column) || hint?.Delimiter is not null)
            {
                cells.Add(Cell(WriteField(name, column, item[name], escapes)));
                continue;
            }
            if (header) throw new MapFormatException($"Repeating group \"{name}\" needs a flat.delimiter in a CSV file with a header, so its items share one field");
            var list = ListOf(item[name]);
            if (hint?.Count is { } most && list.Count > most) throw new MapFormatException($"\"{name}\" has {list.Count} items, more than the {most} its line has room for");
            var parts = PartsOfItem(column!.Items);
            foreach (var entry in list)
                foreach (var (part, schema) in parts)
                    cells.Add(Cell(WriteField(part ?? name, schema, part is null ? entry : entry is JsonObject record ? record[part] : null, escapes)));
            for (var n = list.Count; n < (hint?.Count ?? 0); n++) cells.AddRange(parts.Select(_ => ""));
        }
        return cells;
    }

    /// <summary>Each line ends with the terminator, if there is one, then the line ending, which is none by default after a terminator.</summary>
    private static string NewlineOf(FlatHint? hint) => hint?.Terminator is { } terminator ? terminator + (hint.LineEnding ?? "") : hint?.LineEnding ?? "\n";

    /// <summary>With a release character, separators in values are released rather than quoted.</summary>
    private static Escapes EscapesFor(Schema? schema) =>
        schema?.Flat?.Release is { } release ? new Escapes(release, [release, .. SeparatorsOf(schema, []).Where(s => s != release)]) : new Escapes(null, []);

    /// <summary>An EDI segment, ended by a terminator, leaves off empty fields at its end.</summary>
    private static List<string> Ends(FlatHint? hint, List<string> cells) => hint?.Terminator is not null ? WithoutTrailing(cells) : cells;

    private static string AsText(JsonNode node) => node.GetValueKind() == JsonValueKind.String ? node.GetValue<string>() : Operators.Coerce.ToText(Value.Of(node));

    /// <summary>
    /// Writes what a map made as a CSV or fixed-width file, following the target schema: a line per item of its
    /// row field, columns in the schema's order, and for CSV a header row. A fixed-width value too wide for its
    /// column is an error, rather than cut short.
    /// </summary>
    public static string Write(JsonNode? value, Schema? schema = null)
    {
        if (KindsOf(schema).Count > 0) return WriteKinds(value, schema!);
        var hint = schema?.Flat;
        var (key, row) = RowsOf(schema);
        var records = value is JsonObject root ? root[key] : null;
        if (records is not null and not JsonArray) throw new MapFormatException($"\"{key}\" should be an array of rows");
        var items = (records as JsonArray ?? []).OfType<JsonObject>().ToList();
        var columns = row?.Properties is { Count: > 0 } known
            ? known.Select(p => (Name: p.Key, Column: (Schema?)p.Value)).ToList()
            : items.SelectMany(r => r.Select(p => p.Key)).Distinct().Select(name => (Name: name, Column: (Schema?)null)).ToList();
        var newline = NewlineOf(hint);
        var lines = new List<string>();

        if (hint?.Format == "fixed")
        {
            // Headings are text, left-aligned and padded with spaces, whatever their column holds; a group's spans its slots.
            int HeadingWidth(string name, Schema? column) =>
                IsGroup(column) ? FixedWidthOf(name, column!.Items) * (column.Flat?.Count ?? 1) : IsComposite(column) ? FixedWidthOf(name, column) : column?.Flat?.Width ?? 0;
            if (hint.Header == true) lines.Add(string.Concat(columns.Select(c => FixedCell(c.Name, new Schema { Type = "string", Flat = new FlatHint(null, null, null, null, 0, null, null, HeadingWidth(c.Name, c.Column), null, null, 0) }, JsonValue.Create(c.Column?.Flat?.Name ?? c.Name)))));
            foreach (var item in items) lines.Add(WriteFixed(columns, item));
            return lines.Count > 0 ? string.Join(newline, lines) + newline : "";
        }

        var delimiter = hint?.Delimiter ?? ",";
        var quote = QuoteOf(hint);
        var escapes = EscapesFor(schema);
        string Field(string text) => hint?.Release is not null ? text : CsvField(text, delimiter, quote);
        var header = hint?.Header ?? true;
        if (header) lines.Add(string.Join(delimiter, columns.Select(c => Field(c.Column?.Flat?.Name ?? c.Name))));
        foreach (var item in items) lines.Add(string.Join(delimiter, Ends(hint, WriteCsv(columns, item, Field, header, escapes))));
        return lines.Count > 0 ? string.Join(newline, lines) + newline : "";
    }
}
