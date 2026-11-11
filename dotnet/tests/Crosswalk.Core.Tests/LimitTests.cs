using System.Text.Json.Nodes;
using Crosswalk.Operators;

namespace Crosswalk.Tests;

public class LimitTests
{
    private int _cancelled;

    // An operator that takes a while: spinning for sync runs, waiting for async ones.
    private static readonly ValueOperator Slow = new()
    {
        Id = "test.slow",
        Label = "Slow",
        Category = "custom",
        Inputs = new(1, 1),
        Run = args =>
        {
            // A synchronous operator can't be interrupted, only stopped between steps.
            Thread.Sleep(5);
            return args[0];
        },
    };

    private AsyncValueOperator Wait => new()
    {
        Id = "test.wait",
        Label = "Wait",
        Category = "custom",
        Inputs = new(1, 1),
        Run = async (args, cancellationToken) =>
        {
            try
            {
                await Task.Delay(1000, cancellationToken);
                return args[0];
            }
            catch (OperationCanceledException)
            {
                Interlocked.Increment(ref _cancelled);
                throw;
            }
        },
    };

    private static string LoopOver(string op) => $$"""
    {
      "version": 1,
      "source": { "type": "object", "properties": { "Items": { "type": "array", "items": { "type": "object", "properties": { "V": { "type": "string" } } } } } },
      "target": { "type": "object", "properties": { "Out": { "type": "array", "items": { "type": "object", "properties": { "V": { "type": "string" } } } } } },
      "loops": [{ "source": "Items[]", "target": "Out[]" }],
      "nodes": [{ "id": "op", "operator": "{{op}}" }],
      "links": [
        { "from": { "source": "Items[].V" }, "to": { "node": "op", "input": 0 } },
        { "from": { "node": "op" }, "to": { "target": "Out[].V" } }
      ]
    }
    """;

    private static JsonObject Items(int count)
    {
        var items = new JsonArray();
        for (var i = 0; i < count; i++) items.Add(new JsonObject { ["V"] = $"v{i}" });
        return new JsonObject { ["Items"] = items };
    }

    private MapTransform Transform(string op, RunLimits limits) =>
        MapTransform.Create(LoopOver(op), new TransformOptions { Registry = OperatorRegistry.Create(new RegistryOptions { Operators = [Slow, Wait] }), Limits = limits });

    [Fact]
    public void TimeoutsStopASynchronousRunBetweenSteps()
    {
        var transform = Transform("test.slow", new RunLimits { Timeout = TimeSpan.FromMilliseconds(30) });
        var error = Assert.Throws<MapLimitException>(() => transform.Run(Items(40)));
        Assert.Equal("timeout", error.Limit);
    }

    [Fact]
    public async Task TimeoutsCancelTheOperatorsAnAsyncRunIsWaitingOn()
    {
        var transform = Transform("test.wait", new RunLimits { Timeout = TimeSpan.FromMilliseconds(30) });
        var error = await Assert.ThrowsAsync<MapLimitException>(async () => await transform.RunAsync(Items(3)));
        Assert.Equal("timeout", error.Limit);
        Assert.Equal(3, _cancelled);
    }

    [Fact]
    public async Task YourOwnCancellationStaysACancellation()
    {
        var transform = Transform("test.wait", new RunLimits { Timeout = TimeSpan.FromSeconds(5) });
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(20));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await transform.RunAsync(Items(2), cancel.Token));
    }

    [Fact]
    public void ForUserMapsIsGenerousForRealMaps()
    {
        Assert.Equal(new RunLimits
        {
            MaxNodes = 500,
            MaxLinks = 2000,
            MaxOperatorRuns = 1_000_000,
            MaxOutputValues = 1_000_000,
            MaxTextLength = 1_000_000,
            Timeout = TimeSpan.FromSeconds(5),
        }, RunLimits.ForUserMaps);
    }

    private static JsonObject PersonRequest()
    {
        var folder = Path.Combine(FindConformance(), "maps", "person-profile");
        return new JsonObject
        {
            ["map"] = JsonNode.Parse(File.ReadAllText(Path.Combine(folder, "map.json"))),
            ["input"] = JsonNode.Parse(File.ReadAllText(Path.Combine(folder, "input.json"))),
        };
    }

    [Fact]
    public async Task PreviewReportsTheLimit()
    {
        var response = await CrosswalkPreview.HandleAsync(PersonRequest(), OperatorRegistry.Create(), limits: new RunLimits { MaxOperatorRuns = 3 });
        Assert.Equal("maxOperatorRuns", response["error"]!["limit"]!.GetValue<string>());
    }

    [Fact]
    public async Task PreviewRefusesAnOversizedMapBeforeAnalysingIt()
    {
        var response = await CrosswalkPreview.HandleAsync(PersonRequest(), OperatorRegistry.Create(), limits: new RunLimits { MaxNodes = 2 });
        Assert.Equal("maxNodes", response["error"]!["limit"]!.GetValue<string>());
        Assert.Contains("10 operators", response["error"]!["message"]!.GetValue<string>());
    }

    private static string FindConformance()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "conformance");
            if (Directory.Exists(candidate)) return candidate;
        }
        throw new InvalidOperationException("No conformance folder");
    }
}
