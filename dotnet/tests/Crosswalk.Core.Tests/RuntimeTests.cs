using System.Text.Json.Nodes;
using Crosswalk.Operators;

namespace Crosswalk.Tests;

public class RuntimeTests
{
    private static readonly Dictionary<string, string> Tiers = new() { ["ana"] = "gold", ["bo"] = "silver" };

    /// <summary>A lookup that has to wait, such as a call to another service, counting calls in flight.</summary>
    private sealed class TierLookup
    {
        private int _inFlight;
        public int MostInFlight;
        public int Calls;

        public AsyncValueOperator Operator => new()
        {
            Id = "acme.tier",
            Label = "Customer tier",
            Category = "custom",
            Inputs = new(1, 1),
            Run = async (args, cancellationToken) =>
            {
                Interlocked.Increment(ref Calls);
                var now = Interlocked.Increment(ref _inFlight);
                InterlockedMax(ref MostInFlight, now);
                try
                {
                    await Task.Delay(10, cancellationToken);
                    var id = Coerce.ToText(args[0]);
                    return Tiers.TryGetValue(id, out var tier) ? tier : throw new OperatorException($"No customer \"{id}\"");
                }
                finally
                {
                    Interlocked.Decrement(ref _inFlight);
                }
            },
        };

        private static void InterlockedMax(ref int target, int value)
        {
            int current;
            while (value > (current = Volatile.Read(ref target)) && Interlocked.CompareExchange(ref target, value, current) != current) { }
        }
    }

    private const string CustomersMap = """
    {
      "version": 1,
      "source": { "type": "object", "properties": { "Customers": { "type": "array", "items": { "type": "object", "properties": { "Id": { "type": "string" }, "Name": { "type": "string" } } } } } },
      "target": { "type": "object", "properties": { "Rows": { "type": "array", "items": { "type": "object", "properties": { "Name": { "type": "string" }, "Tier": { "type": "string" }, "Shout": { "type": "string" } } } } } },
      "loops": [{ "source": "Customers[]", "target": "Rows[]" }],
      "nodes": [{ "id": "tier", "operator": "acme.tier" }, { "id": "shout", "operator": "text.upper" }],
      "links": [
        { "from": { "source": "Customers[].Name" }, "to": { "target": "Rows[].Name" } },
        { "from": { "source": "Customers[].Id" }, "to": { "node": "tier", "input": 0 } },
        { "from": { "node": "tier" }, "to": { "target": "Rows[].Tier" } },
        { "from": { "node": "tier" }, "to": { "node": "shout", "input": 0 } },
        { "from": { "node": "shout" }, "to": { "target": "Rows[].Shout" } }
      ]
    }
    """;

    private static JsonObject Customers(int count)
    {
        var customers = new JsonArray();
        for (var i = 0; i < count; i++) customers.Add(new JsonObject { ["Id"] = i % 2 == 0 ? "ana" : "bo", ["Name"] = $"C{i}" });
        return new JsonObject { ["Customers"] = customers };
    }

    private static MapTransform Transform(TierLookup lookup, int concurrency = 8) =>
        MapTransform.Create(CustomersMap, new TransformOptions { Registry = OperatorRegistry.Create(new RegistryOptions { Operators = [lookup.Operator] }), Concurrency = concurrency });

    [Fact]
    public async Task AsyncOperatorsRunInLoopsAlongsideSyncOnes()
    {
        var output = await Transform(new TierLookup()).RunAsync(Customers(3));
        Assert.Equal(
            """{"Rows":[{"Name":"C0","Tier":"gold","Shout":"GOLD"},{"Name":"C1","Tier":"silver","Shout":"SILVER"},{"Name":"C2","Tier":"gold","Shout":"GOLD"}]}""",
            output.ToJsonString());
    }

    [Fact]
    public void RunRefusesAnAsyncMapAndSaysWhy()
    {
        var transform = Transform(new TierLookup());
        Assert.True(transform.IsAsync);
        var error = Assert.Throws<InvalidOperationException>(() => transform.Run(Customers(1)));
        Assert.Contains("RunAsync: \"tier\"", error.Message);
    }

    [Theory]
    [InlineData(3, 3)]
    [InlineData(8, 8)]
    public async Task AsyncCallsAreLimited(int concurrency, int expected)
    {
        var lookup = new TierLookup();
        await Transform(lookup, concurrency).RunAsync(Customers(24));
        Assert.Equal(expected, lookup.MostInFlight);
        Assert.Equal(24, lookup.Calls);
    }

    [Fact]
    public async Task AFailedLookupNamesTheNode()
    {
        var input = new JsonObject { ["Customers"] = new JsonArray { new JsonObject { ["Id"] = "nobody", ["Name"] = "X" } } };
        var error = await Assert.ThrowsAsync<MapRuntimeException>(async () => await Transform(new TierLookup()).RunAsync(input));
        Assert.Equal("tier", error.Node);
        Assert.Contains("No customer \"nobody\"", error.Message);
    }

    [Fact]
    public async Task CancellingStopsTheRun()
    {
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(25));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await Transform(new TierLookup(), concurrency: 1).RunAsync(Customers(40), cancel.Token));
    }

    [Fact]
    public async Task AnAlreadyCancelledRunNeverStarts()
    {
        var lookup = new TierLookup();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await Transform(lookup).RunAsync(Customers(2), new CancellationToken(canceled: true)));
        Assert.Equal(0, lookup.Calls);
    }

    [Fact]
    public void ConcurrencyMustBeSensible()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Transform(new TierLookup(), concurrency: 0));
    }

    [Fact]
    public void OneTransformRunsSafelyOnManyThreads()
    {
        var transform = MapTransform.Create(File.ReadAllText(Path.Combine(ConformanceFolder, "maps", "person-profile", "map.json")));
        var input = JsonNode.Parse(File.ReadAllText(Path.Combine(ConformanceFolder, "maps", "person-profile", "input.json")));
        var expected = transform.Run(input).ToJsonString();
        var outputs = new string[200];
        Parallel.For(0, outputs.Length, i => outputs[i] = transform.Run(input).ToJsonString());
        Assert.All(outputs, output => Assert.Equal(expected, output));
    }

    [Fact]
    public void BuiltinsCanBeChosen()
    {
        Assert.Equal(BuiltinOperators.All.Count, OperatorRegistry.Create().List().Count);
        Assert.Empty(OperatorRegistry.Create(new RegistryOptions { Builtins = _ => false }).List());
        var noMath = OperatorRegistry.Create(new RegistryOptions { Builtins = op => op.Category != "math" });
        Assert.False(noMath.Has("math.add"));
        Assert.DoesNotContain(noMath.Categories(), c => c.Id == "math");
    }

    [Fact]
    public void YourOwnOperatorsAndCategories()
    {
        var shout = new ValueOperator { Id = "acme.shout", Label = "Shout", Category = "acme", Inputs = new(1, 1), Run = args => Coerce.ToText(args[0]) + "!" };
        var registry = OperatorRegistry.Create(new RegistryOptions { Builtins = _ => false, Categories = [new("acme", "Acme", "#ff3366")], Operators = [shout] });
        Assert.Equal("Acme", registry.GetCategory("acme")!.Label);
        Assert.Throws<ArgumentException>(() => new CategoryDefinition("my category", "Mine"));
        Assert.Throws<ArgumentException>(() => registry.Register(shout));
    }

    [Fact]
    public void AnOperatorTakenOutIsReportedAsUnknown()
    {
        var registry = OperatorRegistry.Create().Unregister("text.concat");
        var map = MapDocument.Parse(File.ReadAllText(Path.Combine(ConformanceFolder, "maps", "person-profile", "map.json")));
        var issue = Assert.Single(MapAnalyser.Analyse(map, registry).Errors);
        Assert.Equal("unknown-operator", issue.Code);
        Assert.Equal("fullName", issue.Node);
        Assert.Throws<MapValidationException>(() => MapTransform.Create(map, new TransformOptions { Registry = registry }));
    }

    [Fact]
    public void TheCatalogDescribesOperatorsForTheEditor()
    {
        var catalog = OperatorRegistry.Create(new RegistryOptions { Operators = [new TierLookup().Operator] }).ToCatalog();
        var operators = catalog["operators"]!.AsArray();
        Assert.Equal(BuiltinOperators.All.Count + 1, operators.Count);
        var tier = operators.Single(o => o!["id"]!.GetValue<string>() == "acme.tier")!;
        Assert.True(tier["async"]!.GetValue<bool>());
        Assert.Equal("""{"min":1,"max":1}""", tier["inputs"]!.ToJsonString());
        var sum = operators.Single(o => o!["id"]!.GetValue<string>() == "aggregate.sum")!;
        Assert.Equal("aggregate", sum["kind"]!.GetValue<string>());
        Assert.Contains(catalog["categories"]!.AsArray(), c => c!["id"]!.GetValue<string>() == "custom");
    }

    [Theory]
    [InlineData("not json", "isn't valid JSON")]
    [InlineData("[]", "must be a JSON object")]
    [InlineData("""{ "version": 1, "target": { "type": "object" }, "nodes": [], "links": [] }""", "source schema must be an object")]
    [InlineData("""{ "version": 1, "source": { "type": "object" }, "target": { "type": "object" }, "links": [] }""", "\"nodes\" array")]
    public void JsonThatIsntAMapSaysWhy(string json, string message)
    {
        var error = Assert.Throws<MapFormatException>(() => MapDocument.Parse(json));
        Assert.Contains(message, error.Message);
    }

    [Fact]
    public void AbsentIsntNull()
    {
        Assert.True(Value.Absent.IsAbsent);
        Assert.False(Value.Null.IsAbsent);
        Assert.True(Value.Null.IsNull);
        Assert.NotEqual(Value.Absent, Value.Null);
        Assert.Equal((Value)"x", (Value)JsonValue.Create("x"));
    }

    private static string ConformanceFolder
    {
        get
        {
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, "conformance");
                if (Directory.Exists(candidate)) return candidate;
            }
            throw new InvalidOperationException("No conformance folder");
        }
    }
}
