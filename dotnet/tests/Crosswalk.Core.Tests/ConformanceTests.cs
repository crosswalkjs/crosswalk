// Runs the shared conformance suite in /conformance, which every Crosswalk runtime
// must pass, through both Run and RunAsync. See conformance/README.md for the format.
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Crosswalk.Tests;

public class ConformanceTests
{
    private static readonly string Root = FindConformance();

    private static string FindConformance()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "conformance");
            if (File.Exists(Path.Combine(candidate, "operators.json"))) return candidate;
        }
        throw new InvalidOperationException("Couldn't find the conformance folder above the test output");
    }

    private static JsonNode? Read(string path) => JsonNode.Parse(File.ReadAllText(path));

    private static readonly JsonObject Operators = (JsonObject)Read(Path.Combine(Root, "operators.json"))!;

    private static bool Marker(JsonNode? node, string name) => node is JsonObject obj && obj[name] is JsonValue v && v.GetValueKind() == JsonValueKind.True;

    private static bool IsAbsent(JsonNode? node) => Marker(node, "$absent");

    private static bool IsError(JsonNode? node) => Marker(node, "$error");

    /// <summary>JSON equality ignoring key order, with numbers equal to within 1e-9 relative, as the suite's README defines.</summary>
    private static bool Same(JsonNode? actual, JsonNode? expected)
    {
        if (expected is null || actual is null) return expected is null && actual is null;
        var kind = expected.GetValueKind();
        if (kind == JsonValueKind.Number)
        {
            if (actual.GetValueKind() != JsonValueKind.Number) return false;
            double a = double.Parse(actual.ToJsonString(), CultureInfo.InvariantCulture), e = double.Parse(expected.ToJsonString(), CultureInfo.InvariantCulture);
            return Math.Abs(a - e) <= 1e-9 * Math.Max(1, Math.Abs(e));
        }
        if (expected is JsonArray expectedArray)
        {
            return actual is JsonArray actualArray && actualArray.Count == expectedArray.Count && expectedArray.Select((item, i) => Same(actualArray[i], item)).All(x => x);
        }
        if (expected is JsonObject expectedObject)
        {
            return actual is JsonObject actualObject
                && actualObject.Count == expectedObject.Count
                && expectedObject.All(p => actualObject.TryGetPropertyValue(p.Key, out var value) && Same(value, p.Value));
        }
        return JsonNode.DeepEquals(actual, expected);
    }

    /// <summary>Runs a map both ways. Each must give the same result.</summary>
    private static async Task<(List<JsonObject> Outputs, List<Exception> Errors)> BothWays(MapDocument map, JsonNode? input, RunLimits? limits = null)
    {
        var outputs = new List<JsonObject>();
        var errors = new List<Exception>();
        var options = new TransformOptions { Limits = limits ?? RunLimits.None };
        // Created each time, inside the try: the map-size limits fail at creation.
        try { outputs.Add(MapTransform.Create(map, options).Run(input)); } catch (Exception error) { errors.Add(error); }
        try { outputs.Add(await MapTransform.Create(map, options).RunAsync(input)); } catch (Exception error) { errors.Add(error); }
        return (outputs, errors);
    }

    private static RunLimits ReadLimits(JsonNode? json)
    {
        int? Int(string name) => json?[name] is JsonNode value ? value.GetValue<int>() : null;
        return new RunLimits
        {
            MaxNodes = Int("maxNodes"),
            MaxLinks = Int("maxLinks"),
            MaxOperatorRuns = Int("maxOperatorRuns"),
            MaxOutputValues = Int("maxOutputValues"),
            MaxTextLength = Int("maxTextLength"),
            Timeout = Int("timeout") is { } ms ? TimeSpan.FromMilliseconds(ms) : null,
        };
    }

    /// <summary>Runs a one-operator map whose output field is <c>out</c>, and checks it against <paramref name="expected"/>.</summary>
    private static async Task Check(JsonObject mapJson, JsonNode? input, JsonNode? expected)
    {
        var map = MapDocument.FromJson(mapJson);
        Assert.Empty(MapAnalyser.Analyse(map).Errors);
        var (outputs, errors) = await BothWays(map, input);
        if (IsError(expected))
        {
            Assert.Equal(2, errors.Count);
            Assert.All(errors, error => Assert.IsType<MapRuntimeException>(error));
            return;
        }
        Assert.Empty(errors);
        foreach (var output in outputs)
        {
            if (IsAbsent(expected)) Assert.Empty(output);
            else Assert.True(Same(output["out"], expected), $"got {output["out"]?.ToJsonString() ?? "null"}, expected {expected?.ToJsonString() ?? "null"}");
        }
    }

    private static JsonObject OutSchema() => new() { ["type"] = "object", ["properties"] = new JsonObject { ["out"] = new JsonObject { ["type"] = "string" } } };

    public static IEnumerable<object[]> ValueCases() =>
        ((JsonArray)Operators["value"]!).Select((c, i) => new object[] { $"{c!["operator"]}({string.Join(", ", ((JsonArray)c["inputs"]!).Select(x => x?.ToJsonString() ?? "null"))})", i });

    [Theory]
    [MemberData(nameof(ValueCases))]
    public async Task ValueOperator(string name, int index)
    {
        _ = name;
        var c = (JsonObject)Operators["value"]![index]!;
        // An absent input is a link from a source field the input doesn't have.
        var constants = new JsonObject();
        var links = new JsonArray { new JsonObject { ["from"] = new JsonObject { ["node"] = "op" }, ["to"] = new JsonObject { ["target"] = "out" } } };
        var inputs = (JsonArray)c["inputs"]!;
        for (var i = 0; i < inputs.Count; i++)
        {
            if (IsAbsent(inputs[i])) links.Add(new JsonObject { ["from"] = new JsonObject { ["source"] = "missing" }, ["to"] = new JsonObject { ["node"] = "op", ["input"] = i } });
            else constants[i.ToString(CultureInfo.InvariantCulture)] = inputs[i]?.DeepClone();
        }
        var map = new JsonObject
        {
            ["version"] = 1,
            ["source"] = new JsonObject { ["type"] = "object", ["properties"] = new JsonObject { ["missing"] = new JsonObject { ["type"] = "string" } } },
            ["target"] = OutSchema(),
            ["nodes"] = new JsonArray { new JsonObject { ["id"] = "op", ["operator"] = c["operator"]!.DeepClone(), ["constants"] = constants } },
            ["links"] = links,
        };
        await Check(map, new JsonObject(), c["expected"]);
    }

    public static IEnumerable<object[]> AggregateCases() =>
        ((JsonArray)Operators["aggregate"]!).Select((c, i) => new object[] { $"{c!["operator"]}({string.Join(", ", ((JsonArray)c["values"]!).Select(x => x?.ToJsonString() ?? "null"))})", i });

    [Theory]
    [MemberData(nameof(AggregateCases))]
    public async Task AggregateOperator(string name, int index)
    {
        _ = name;
        var c = (JsonObject)Operators["aggregate"]![index]!;
        var map = new JsonObject
        {
            ["version"] = 1,
            ["source"] = new JsonObject
            {
                ["type"] = "object",
                ["properties"] = new JsonObject
                {
                    ["items"] = new JsonObject { ["type"] = "array", ["items"] = new JsonObject { ["type"] = "object", ["properties"] = new JsonObject { ["v"] = new JsonObject { ["type"] = "string" } } } },
                },
            },
            ["target"] = OutSchema(),
            ["nodes"] = new JsonArray { new JsonObject { ["id"] = "op", ["operator"] = c["operator"]!.DeepClone(), ["scope"] = "items[]" } },
            ["links"] = new JsonArray
            {
                new JsonObject { ["from"] = new JsonObject { ["source"] = "items[].v" }, ["to"] = new JsonObject { ["node"] = "op", ["input"] = 0 } },
                new JsonObject { ["from"] = new JsonObject { ["node"] = "op" }, ["to"] = new JsonObject { ["target"] = "out" } },
            },
        };
        // An absent value is an item without v.
        var items = new JsonArray();
        foreach (var value in (JsonArray)c["values"]!) items.Add(IsAbsent(value) ? new JsonObject() : new JsonObject { ["v"] = value?.DeepClone() });
        await Check(map, new JsonObject { ["items"] = items }, c["expected"]);
    }

    [Fact]
    public void TextOfANumber()
    {
        var cases = (JsonArray)Read(Path.Combine(Root, "number-text.json"))!["cases"]!;
        var wrong = cases
            .Select(pair => (Number: pair![0], Text: pair[1]!.GetValue<string>()))
            .Where(pair => Crosswalk.Operators.Coerce.ToText(Value.Of(pair.Number)) != pair.Text)
            .Select(pair => $"{pair.Number!.ToJsonString()}: want \"{pair.Text}\", got \"{Crosswalk.Operators.Coerce.ToText(Value.Of(pair.Number))}\"")
            .ToList();
        Assert.True(wrong.Count == 0, string.Join("\n", wrong));
    }

    [Fact]
    public void Catalogue()
    {
        var expected = Read(Path.Combine(Root, "catalog.json"));
        var actual = Crosswalk.Operators.OperatorRegistry.Create().ToCatalog();
        Assert.True(Same(actual, expected), $"got {actual.ToJsonString()}");
    }

    public static IEnumerable<object[]> MapCases() =>
        Directory.GetDirectories(Path.Combine(Root, "maps")).Select(Path.GetFileName).Order(StringComparer.Ordinal).Select(name => new object[] { name! });

    [Theory]
    [MemberData(nameof(MapCases))]
    public async Task Map(string name)
    {
        var dir = Path.Combine(Root, "maps", name);
        string File(string part) => Path.Combine(dir, part);
        var map = MapDocument.FromJson(Read(File("map.json")));
        var issues = MapAnalyser.Analyse(map).Issues;

        if (System.IO.File.Exists(File("expected-issues.json")))
        {
            // Each expected issue must match one reported issue on the fields it gives; messages aren't compared.
            var unmatched = issues.ToList();
            foreach (var want in (JsonArray)Read(File("expected-issues.json"))!)
            {
                var severity = want!["severity"]!.GetValue<string>() == "error" ? IssueSeverity.Error : IssueSeverity.Warning;
                var code = want["code"]!.GetValue<string>();
                var node = want["node"]?.GetValue<string>();
                var path = want["path"]?.GetValue<string>();
                var submap = want["submap"]?.GetValue<string>();
                var at = unmatched.FindIndex(i => i.Severity == severity && i.Code == code && (node is null || i.Node == node) && (path is null || i.Path == path) && (submap is null || i.Submap == submap));
                Assert.True(at >= 0, $"expected {want.ToJsonString()} in [{string.Join(", ", issues.Select(i => $"{i.Severity} {i.Code} {i.Node} {i.Path}"))}]");
                unmatched.RemoveAt(at);
            }
            Assert.True(unmatched.Count == 0, $"issues the case doesn't expect: {string.Join(", ", unmatched.Select(i => $"{i.Severity} {i.Code}: {i.Message}"))}");
            return;
        }

        Assert.Empty(MapAnalyser.Analyse(map).Errors);
        var limits = System.IO.File.Exists(File("limits.json")) ? ReadLimits(Read(File("limits.json"))) : null;
        var (outputs, errors) = await BothWays(map, Read(File("input.json")), limits);
        if (System.IO.File.Exists(File("expected-limit.json")))
        {
            var expectedLimit = Read(File("expected-limit.json"))!;
            Assert.Equal(2, errors.Count);
            foreach (var error in errors)
            {
                var limit = Assert.IsType<MapLimitException>(error);
                Assert.Equal(expectedLimit["limit"]!.GetValue<string>(), limit.Limit);
                if (expectedLimit["node"] is JsonNode node) Assert.Equal(node.GetValue<string>(), limit.Node);
            }
            return;
        }
        if (System.IO.File.Exists(File("expected-error.json")))
        {
            var node = Read(File("expected-error.json"))!["node"]!.GetValue<string>();
            Assert.Equal(2, errors.Count);
            Assert.All(errors, error => Assert.Equal(node, Assert.IsType<MapRuntimeException>(error).Node));
            return;
        }
        Assert.Empty(errors);
        var expected = Read(File("expected.json"));
        foreach (var output in outputs) Assert.True(Same(output, expected), $"got {output.ToJsonString()}");
    }

    public static IEnumerable<object[]> XmlCases() =>
        Directory.GetDirectories(Path.Combine(Root, "xml")).Select(Path.GetFileName).Order(StringComparer.Ordinal).Select(name => new object[] { name! });

    /// <summary>XML read into JSON, compared as JSON; and JSON written as XML, compared as text.</summary>
    [Theory]
    [MemberData(nameof(XmlCases))]
    public void Xml(string name)
    {
        string At(string file) => Path.Combine(Root, "xml", name, file);
        var schema = File.Exists(At("schema.json")) ? Schema.FromJson(Read(At("schema.json"))) : null;
        if (File.Exists(At("input.xml")))
        {
            var expected = Read(At("expected.json"));
            var input = File.ReadAllText(At("input.xml"));
            if (IsError(expected)) Assert.ThrowsAny<Exception>(() => XmlJson.Read(input, schema));
            else
            {
                var actual = XmlJson.Read(input, schema);
                Assert.True(Same(actual, expected), $"{name}: expected {expected!.ToJsonString()}, got {actual?.ToJsonString()}");
            }
        }
        else Assert.Equal(File.ReadAllText(At("expected.xml")), XmlJson.Write(Read(At("input.json")), schema));
    }

    public static IEnumerable<object[]> FlatCases() =>
        Directory.GetDirectories(Path.Combine(Root, "flat")).Select(Path.GetFileName).Order(StringComparer.Ordinal).Select(name => new object[] { name! });

    /// <summary>Flat files read into JSON, compared as JSON; and JSON written as a flat file, compared as text.</summary>
    [Theory]
    [MemberData(nameof(FlatCases))]
    public void Flat(string name)
    {
        string At(string file) => Path.Combine(Root, "flat", name, file);
        var schema = File.Exists(At("schema.json")) ? Schema.FromJson(Read(At("schema.json"))) : null;
        if (File.Exists(At("input.txt")))
        {
            var expected = Read(At("expected.json"));
            var input = File.ReadAllText(At("input.txt"));
            if (IsError(expected)) Assert.ThrowsAny<Exception>(() => FlatFile.Read(input, schema));
            else
            {
                var actual = FlatFile.Read(input, schema);
                Assert.True(Same(actual, expected), $"{name}: expected {expected!.ToJsonString()}, got {actual.ToJsonString()}");
            }
        }
        else if (File.Exists(At("expected.txt"))) Assert.Equal(File.ReadAllText(At("expected.txt")), FlatFile.Write(Read(At("input.json")), schema));
        else Assert.ThrowsAny<Exception>(() => FlatFile.Write(Read(At("input.json")), schema));
    }
}
