using System.Text.Json.Nodes;
using Crosswalk.Operators;

namespace Crosswalk;

/// <summary>
/// Serves the editor's live preview: runs a map someone is drawing against a sample
/// input, with this runtime's operators. Map it to an endpoint and point the editor's
/// <c>previewOverHttp</c> at it.
/// </summary>
/// <remarks>
/// The request is <c>{ "map": ..., "input": ... }</c>. The response is one of
/// <c>{ "output": ... }</c>, <c>{ "issues": [...] }</c> when the map has errors, or
/// <c>{ "error": { "message": ..., "node": ..., "limit"?: ... } }</c> when an operator fails on
/// the input or a limit stops the run.
/// </remarks>
public static class CrosswalkPreview
{
    /// <summary>
    /// Runs the map in a preview request and describes the result. Cancelling the token stops
    /// the run. A preview runs whatever someone has drawn, so <see cref="RunLimits.ForUserMaps"/>
    /// applies unless you pass other <paramref name="limits"/>.
    /// </summary>
    public static async Task<JsonObject> HandleAsync(JsonNode? request, OperatorRegistry registry, CancellationToken cancellationToken = default, RunLimits? limits = null)
    {
        MapDocument map;
        try
        {
            map = MapDocument.FromJson(request?["map"]);
        }
        catch (MapFormatException error)
        {
            return Issues([new MapIssue(IssueSeverity.Error, "invalid-map", error.Message)]);
        }

        try
        {
            // Creating the transform checks the map's size before analysing it, so an oversized map costs nothing.
            var transform = MapTransform.Create(map, new TransformOptions { Registry = registry, Limits = limits ?? RunLimits.ForUserMaps });
            var output = await transform.RunAsync(request?["input"]?.DeepClone(), cancellationToken).ConfigureAwait(false);
            return new JsonObject { ["output"] = output };
        }
        catch (MapValidationException error)
        {
            return Issues(error.Issues);
        }
        catch (MapRuntimeException error)
        {
            return new JsonObject { ["error"] = new JsonObject { ["message"] = error.Message, ["node"] = error.Node } };
        }
        catch (MapLimitException error)
        {
            var details = new JsonObject { ["message"] = error.Message, ["limit"] = error.Limit };
            if (error.Node is { } node) details["node"] = node;
            return new JsonObject { ["error"] = details };
        }
    }

    private static JsonObject Issues(IEnumerable<MapIssue> issues)
    {
        var list = new JsonArray();
        foreach (var issue in issues)
        {
            var entry = new JsonObject
            {
                ["severity"] = issue.Severity == IssueSeverity.Error ? "error" : "warning",
                ["code"] = issue.Code,
                ["message"] = issue.Message,
            };
            if (issue.Node is { } node) entry["node"] = node;
            if (issue.Path is { } path) entry["path"] = path;
            if (issue.Link is { } link) entry["link"] = link;
            list.Add((JsonNode)entry);
        }
        return new JsonObject { ["issues"] = list };
    }
}
