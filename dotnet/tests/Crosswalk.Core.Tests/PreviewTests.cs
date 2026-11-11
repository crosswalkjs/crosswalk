using System.Text.Json.Nodes;
using Crosswalk.Operators;

namespace Crosswalk.Tests;

public class PreviewTests
{
    private static JsonNode? Case(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(FindConformance(), "maps", "person-profile", file)));

    private static string FindConformance()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "conformance");
            if (Directory.Exists(candidate)) return candidate;
        }
        throw new InvalidOperationException("No conformance folder");
    }

    [Fact]
    public async Task ReturnsTheOutput()
    {
        var response = await CrosswalkPreview.HandleAsync(new JsonObject { ["map"] = Case("map.json"), ["input"] = Case("input.json") }, OperatorRegistry.Create());
        Assert.Equal("Ana Silva", response["output"]!["FullName"]!.GetValue<string>());
    }

    [Fact]
    public async Task ReturnsTheMapsErrorsInsteadOfRunningIt()
    {
        var map = Case("map.json")!;
        map["links"]!.AsArray().Add(JsonNode.Parse("""{ "from": { "source": "Nope" }, "to": { "target": "FullName" } }"""));
        var response = await CrosswalkPreview.HandleAsync(new JsonObject { ["map"] = map, ["input"] = Case("input.json") }, OperatorRegistry.Create());
        var issue = Assert.Single(response["issues"]!.AsArray());
        Assert.Equal("unknown-source", issue!["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task NamesTheOperatorThatFailsOnTheInput()
    {
        var input = Case("input.json")!;
        input["PhoneCalls"] = JsonNode.Parse("""[{ "PhoneNumber": "+351", "Cost": "lots" }]""");
        var response = await CrosswalkPreview.HandleAsync(new JsonObject { ["map"] = Case("map.json"), ["input"] = input }, OperatorRegistry.Create());
        Assert.Equal("totalNational", response["error"]!["node"]!.GetValue<string>());
    }

    [Fact]
    public async Task SaysWhenTheRequestIsntAMap()
    {
        var response = await CrosswalkPreview.HandleAsync(new JsonObject { ["map"] = "nope" }, OperatorRegistry.Create());
        Assert.Equal("invalid-map", response["issues"]![0]!["code"]!.GetValue<string>());
    }
}
