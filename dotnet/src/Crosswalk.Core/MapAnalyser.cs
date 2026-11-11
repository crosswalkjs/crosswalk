using System.Text.Json.Nodes;
using Crosswalk.Operators;

namespace Crosswalk;

public enum IssueSeverity
{
    /// <summary>The map can't run.</summary>
    Error,

    /// <summary>Worth knowing, such as an operator that feeds nothing, but the map still runs.</summary>
    Warning,
}

/// <summary>Something wrong with a map. <see cref="Code"/> is stable; <see cref="Message"/> is for people.</summary>
public sealed record MapIssue(IssueSeverity Severity, string Code, string Message)
{
    /// <summary>The node the issue is about, when there is one.</summary>
    public string? Node { get; init; }

    /// <summary>The index of the link the issue is about, when there is one.</summary>
    public int? Link { get; init; }

    /// <summary>The field path the issue is about, when there is one.</summary>
    public string? Path { get; init; }

    /// <summary>The sub-map the issue is in, when it's in one.</summary>
    public string? Submap { get; init; }
}

/// <summary>A link that fills a target record from a source record, whole or through a sub-map.</summary>
internal sealed record RecordLink(string From, string? Submap, int Link);

internal sealed class PlannedNode(OperatorNode node, OperatorDefinition definition)
{
    public OperatorNode Node { get; } = node;
    public OperatorDefinition Definition { get; } = definition;
    public Dictionary<int, LinkEnd> Inputs { get; } = [];
    public Dictionary<int, JsonNode?> Constants { get; } = [];
    public int InputCount { get; set; }
}

/// <summary>Everything the evaluator needs, looked up ahead of time.</summary>
internal sealed class MapPlan(MapDocument document, Dictionary<string, MapPlan> submaps)
{
    public MapDocument Document { get; } = document;
    /// <summary>The record link filling each target record, by path.</summary>
    public Dictionary<string, RecordLink> RecordLinks { get; } = [];
    /// <summary>Plans for the document's sub-maps, by name, shared by the map and its sub-maps.</summary>
    public Dictionary<string, MapPlan> Submaps { get; } = submaps;
    public Dictionary<string, PlannedNode> Nodes { get; } = [];
    /// <summary>The incoming link of each mapped target field, by path.</summary>
    public Dictionary<string, LinkEnd> TargetLinks { get; } = [];
    public Dictionary<string, Loop> LoopsByTarget { get; } = [];
}

/// <summary>The result of checking a map: its issues, and the plan for running it.</summary>
public sealed class MapAnalysis
{
    internal MapAnalysis(IReadOnlyList<MapIssue> issues, MapPlan plan)
    {
        Issues = issues;
        Plan = plan;
    }

    public IReadOnlyList<MapIssue> Issues { get; }

    public IEnumerable<MapIssue> Errors => Issues.Where(issue => issue.Severity == IssueSeverity.Error);

    internal MapPlan Plan { get; }
}

/// <summary>Checks a map against its schemas and operators without running it.</summary>
public static class MapAnalyser
{
    public static MapAnalysis Analyse(MapDocument document, OperatorRegistry? registry = null) =>
        Analyse(document, registry ?? OperatorRegistry.Create(), new SubmapContext(document.Submaps, [], [], []));

    private sealed record SubmapContext(
        IReadOnlyDictionary<string, MapDocument> Submaps,
        Dictionary<string, MapPlan> Plans,
        HashSet<string> Reported,
        List<string> Stack);

    /// <summary>The source and target paths a map reads and writes, to check a sub-map fits its records.</summary>
    private static (List<string> Reads, List<string> Writes) PathsUsed(MapDocument map)
    {
        var reads = new List<string>();
        var writes = new List<string>();
        foreach (var link in map.Links)
        {
            if (link.From.Source is { } source) reads.Add(source);
            if (link.To.Target is { } target) writes.Add(target);
        }
        foreach (var loop in map.Loops)
        {
            reads.Add(loop.Source);
            reads.AddRange(loop.SortBy.Select(k => k.Path));
            if (loop.GroupBy is { } groupBy) reads.Add(groupBy);
            writes.Add(loop.Target);
        }
        foreach (var node in map.Nodes) if (node.Scope is { } scope) reads.Add(scope);
        return (reads, writes);
    }

    /// <summary>The records in a schema, the root first, then depth first in property order, with an array's items as a record of their own.</summary>
    private static IEnumerable<(string Path, Schema Schema)> Records(Schema schema, string path)
    {
        if (schema.Type != "object") yield break;
        yield return (path, schema);
        foreach (var (name, child) in schema.Properties)
        {
            var shape = child.Type == "array" ? child.Items : child;
            if (shape is null) continue;
            foreach (var record in Records(shape, Paths.Child(path, name, child))) yield return record;
        }
    }

    /// <summary>The <c>$ref</c>s in a schema that don't point at anything it defines.</summary>
    private static IEnumerable<string> UnresolvedRefs(Schema schema)
    {
        var missing = new List<string>();
        void Visit(Schema? node)
        {
            if (node is null) return;
            if (node.UnresolvedRef is { } reference && !missing.Contains(reference)) missing.Add(reference);
            foreach (var (_, child) in node.Properties) Visit(child);
            Visit(node.Items);
        }
        Visit(schema);
        return missing;
    }

    /// <summary>The fields of record <paramref name="from"/> that record <paramref name="to"/> has no place for, outermost first. A record that declares no fields takes any.</summary>
    private static List<string> MissingFields(Schema from, Schema to, string prefix)
    {
        var missing = new List<string>();
        if (to.Properties.Count == 0) return missing;
        foreach (var (name, child) in from.Properties)
        {
            var path = prefix + name;
            if (to.Property(name) is not { } other)
            {
                missing.Add(path);
                continue;
            }
            var a = child.Type == "array" ? child.Items : child;
            var b = other.Type == "array" ? other.Items : other;
            if (child.Type == other.Type && a?.Type == "object" && b?.Type == "object")
                missing.AddRange(MissingFields(a, b, $"{path}{(child.Type == "array" ? "[]" : "")}."));
        }
        return missing;
    }

    private static MapAnalysis Analyse(MapDocument document, OperatorRegistry registry, SubmapContext context)
    {
        var issues = new List<MapIssue>();
        void Error(string code, string message, string? node = null, int? link = null, string? path = null) =>
            issues.Add(new MapIssue(IssueSeverity.Error, code, message) { Node = node, Link = link, Path = path });
        void Warn(string code, string message, string? node = null, int? link = null, string? path = null) =>
            issues.Add(new MapIssue(IssueSeverity.Warning, code, message) { Node = node, Link = link, Path = path });

        var plan = new MapPlan(document, context.Plans);
        var nodes = plan.Nodes;

        if (document.Version != 1) Error("unsupported-version", $"Map version {document.Version} isn't supported");
        if (document.Source.Type != "object") Error("root-not-object", "The source schema's root must be an object");
        if (document.Target.Type != "object") Error("root-not-object", "The target schema's root must be an object");
        foreach (var (side, schema) in new[] { ("source", document.Source), ("target", document.Target) })
        {
            foreach (var reference in UnresolvedRefs(schema)) Error("unknown-ref", $"The {side} schema refers to \"{reference}\", which it doesn't define");
        }

        // Nodes declared in the map, including ones with an unknown operator, so a
        // link to one of those doesn't get reported a second time.
        var declared = new HashSet<string>();
        foreach (var node in document.Nodes)
        {
            if (!declared.Add(node.Id))
            {
                Error("duplicate-node", $"More than one node has the id \"{node.Id}\"", node.Id);
                continue;
            }
            var definition = registry.Get(node.Operator);
            if (definition is null)
            {
                Error("unknown-operator", $"Node \"{node.Id}\" uses \"{node.Operator}\", which isn't a registered operator", node.Id);
                continue;
            }
            var planned = new PlannedNode(node, definition);
            foreach (var (index, value) in node.Constants)
            {
                if (index >= 0) planned.Constants[index] = value;
                else Error("bad-input-index", $"Node \"{node.Id}\" has a constant on something that isn't an input index", node.Id);
            }
            nodes[node.Id] = planned;
        }

        for (var index = 0; index < document.Links.Count; index++)
        {
            var link = document.Links[index];
            // A link with a record at either end, or a sub-map, joins two records.
            if (link.From.Source is { } recordFrom && link.To.Target is { } recordTo
                && Paths.SchemaAt(document.Source, recordFrom) is { } fromSchema && Paths.SchemaAt(document.Target, recordTo) is { } toSchema
                && (!Paths.IsValue(fromSchema) || !Paths.IsValue(toSchema) || link.Submap is not null))
            {
                if (fromSchema.Type != "object" || toSchema.Type != "object")
                    Error("record-mismatch", $"Link {index} joins \"{recordFrom}\" and \"{recordTo}\", but a record link needs a record at both ends", link: index, path: recordTo);
                else if (plan.RecordLinks.ContainsKey(recordTo) || plan.TargetLinks.ContainsKey(recordTo))
                    Error("duplicate-link", $"\"{recordTo}\" has more than one incoming link", link: index, path: recordTo);
                else
                    plan.RecordLinks[recordTo] = new RecordLink(recordFrom, link.Submap, index);
                continue;
            }
            if (link.From.Source is { } sourcePath)
            {
                var schema = Paths.SchemaAt(document.Source, sourcePath);
                if (schema is null)
                {
                    Error("unknown-source", $"Link {index} reads \"{sourcePath}\", which isn't in the source schema", link: index, path: sourcePath);
                    continue;
                }
                if (!Paths.IsValue(schema))
                {
                    Error("not-a-value", $"Link {index} reads \"{sourcePath}\", which is a {schema.Type}, not a value", link: index, path: sourcePath);
                    continue;
                }
            }
            else if (link.From.Node is { } fromNode && !nodes.ContainsKey(fromNode))
            {
                if (!declared.Contains(fromNode)) Error("unknown-node", $"Link {index} comes from node \"{fromNode}\", which doesn't exist", link: index);
                continue;
            }

            if (link.To.Target is { } targetPath)
            {
                var schema = Paths.SchemaAt(document.Target, targetPath);
                if (schema is null)
                {
                    Error("unknown-target", $"Link {index} writes \"{targetPath}\", which isn't in the target schema", link: index, path: targetPath);
                    continue;
                }
                if (!Paths.IsValue(schema))
                {
                    Error("not-a-value", $"Link {index} writes \"{targetPath}\", which is a {schema.Type}, not a value", link: index, path: targetPath);
                    continue;
                }
                if (plan.RecordLinks.ContainsKey(targetPath) || !plan.TargetLinks.TryAdd(targetPath, link.From))
                {
                    Error("duplicate-link", $"\"{targetPath}\" has more than one incoming link", link: index, path: targetPath);
                }
                continue;
            }

            var toNode = link.To.Node!;
            if (!nodes.TryGetValue(toNode, out var target))
            {
                if (!declared.Contains(toNode)) Error("unknown-node", $"Link {index} goes to node \"{toNode}\", which doesn't exist", link: index);
                continue;
            }
            var input = link.To.Input ?? -1;
            if (input < 0)
            {
                Error("bad-input-index", $"Link {index} goes to an input of \"{toNode}\" that isn't an input index", toNode, index);
                continue;
            }
            if (!target.Inputs.TryAdd(input, link.From))
            {
                Error("duplicate-link", $"Input {input} of \"{toNode}\" has more than one incoming link", toNode, index);
            }
        }

        foreach (var planned in nodes.Values)
        {
            var node = planned.Node;
            var definition = planned.Definition;
            foreach (var index in planned.Constants.Keys)
            {
                if (planned.Inputs.ContainsKey(index)) Error("constant-and-link", $"Input {index} of \"{node.Id}\" has both a constant and a link", node.Id);
            }
            var indices = planned.Inputs.Keys.Concat(planned.Constants.Keys).ToList();
            planned.InputCount = indices.Count == 0 ? 0 : indices.Max() + 1;
            for (var index = 0; index < planned.InputCount; index++)
            {
                if (!planned.Inputs.ContainsKey(index) && !planned.Constants.ContainsKey(index))
                    Error("missing-input", $"Input {index} of \"{node.Id}\" has no link or constant", node.Id);
            }
            var (min, max) = (definition.Inputs.Min, definition.Inputs.Max);
            if (planned.InputCount < min || (max is not null && planned.InputCount > max))
            {
                var expected = max is null ? $"at least {min}" : min == max ? $"{min}" : $"{min} to {max}";
                var plural = min == 1 && (max is null or 1) ? "" : "s";
                Error("input-count", $"\"{node.Id}\" ({definition.Label}) takes {expected} input{plural} but has {planned.InputCount}", node.Id);
            }

            if (definition is AggregateOperator)
            {
                if (node.Scope is null)
                    Error("scope-required", $"\"{node.Id}\" ({definition.Label}) needs a scope: the source array it aggregates over", node.Id);
                else if (!node.Scope.EndsWith("[]", StringComparison.Ordinal) || Paths.SchemaAt(document.Source, node.Scope) is null)
                    Error("unknown-scope", $"\"{node.Id}\" aggregates over \"{node.Scope}\", which isn't an array in the source schema", node.Id);
            }
            else if (node.Scope is not null)
            {
                Error("unexpected-scope", $"\"{node.Id}\" ({definition.Label}) isn't an aggregate, so it can't have a scope", node.Id);
            }
        }

        // Scope checks walk node inputs recursively, so they only run on an acyclic graph.
        var done = new HashSet<string>();
        var stack = new List<string>();
        var cyclic = false;
        void Visit(string id)
        {
            var open = stack.IndexOf(id);
            if (open >= 0)
            {
                var members = stack.Skip(open).Append(id).Select(m => $"\"{m}\"");
                Error("cycle", $"{string.Join(" → ", members)} form a cycle", id);
                cyclic = true;
                return;
            }
            if (done.Contains(id)) return;
            stack.Add(id);
            foreach (var from in nodes[id].Inputs.Values)
            {
                if (from.Node is { } upstream && nodes.ContainsKey(upstream)) Visit(upstream);
            }
            stack.RemoveAt(stack.Count - 1);
            done.Add(id);
        }
        foreach (var id in nodes.Keys.ToList()) Visit(id);
        if (cyclic) return new MapAnalysis(issues, plan);

        foreach (var loop in document.Loops)
        {
            if (!loop.Source.EndsWith("[]", StringComparison.Ordinal) || Paths.SchemaAt(document.Source, loop.Source) is null)
                Error("loop-source", $"A loop reads \"{loop.Source}\", which isn't an array in the source schema", path: loop.Source);
            else if (!loop.Target.EndsWith("[]", StringComparison.Ordinal) || Paths.SchemaAt(document.Target, loop.Target) is null)
                Error("loop-target", $"A loop writes \"{loop.Target}\", which isn't an array in the target schema", path: loop.Target);
            else if (!plan.LoopsByTarget.TryAdd(loop.Target, loop))
                Error("duplicate-loop", $"\"{loop.Target}\" has more than one loop", path: loop.Target);
            else
            {
                // Sort and group keys are fields of the item being looped over, not of an array inside it.
                var keys = loop.SortBy.Select(k => k.Path).Concat(loop.GroupBy is { } g ? [g] : []);
                foreach (var key in keys)
                {
                    var schema = Paths.SchemaAt(document.Source, key);
                    var inside = key.StartsWith(loop.Source + ".", StringComparison.Ordinal) && Paths.ArrayScopes(key).Count == Paths.ArrayScopes(loop.Source).Count;
                    if (schema is null || !Paths.IsValue(schema) || !inside)
                        Error("bad-loop-key", $"The loop over \"{loop.Source}\" sorts or groups by \"{key}\", which isn't a field of its items", path: key);
                }
            }
        }

        // The source arrays that have a current item at a target path, one per enclosing target loop.
        var missingLoops = new List<string>();
        HashSet<string> BoundScopes(IEnumerable<string> targetScopes)
        {
            var bound = new HashSet<string>();
            foreach (var scope in targetScopes)
            {
                if (plan.LoopsByTarget.TryGetValue(scope, out var loop)) bound.Add(loop.Source);
                else if (!missingLoops.Contains(scope)) missingLoops.Add(scope);
            }
            return bound;
        }

        foreach (var loop in plan.LoopsByTarget.Values)
        {
            var bound = BoundScopes(Paths.ArrayScopes(loop.Target).SkipLast(1));
            foreach (var scope in Paths.ArrayScopes(loop.Source).SkipLast(1))
            {
                if (!bound.Contains(scope))
                    Error("unbound-scope", $"The loop over \"{loop.Source}\" is inside \"{scope}\", which no enclosing loop repeats over", path: loop.Target);
            }
        }

        // The source arrays a value reads from that need a current item.
        var required = new Dictionary<string, HashSet<string>>();
        HashSet<string> RequiredScopes(LinkEnd from)
        {
            if (from.Source is { } path) return [.. Paths.ArrayScopes(path)];
            var id = from.Node!;
            if (required.TryGetValue(id, out var cached)) return cached;
            var scopes = new HashSet<string>();
            if (nodes.TryGetValue(id, out var planned))
            {
                foreach (var input in planned.Inputs.Values) scopes.UnionWith(RequiredScopes(input));
                if (planned.Definition is AggregateOperator && planned.Node.Scope is { } scope)
                {
                    if (!scopes.Contains(scope))
                        Warn("scope-not-used", $"\"{id}\" aggregates over \"{scope}\", but its input doesn't come from inside it", id);
                    // The node supplies the current item of its scope itself, but the
                    // arrays its scope sits inside still need one.
                    scopes.Remove(scope);
                    scopes.UnionWith(Paths.ArrayScopes(scope).SkipLast(1));
                }
            }
            required[id] = scopes;
            return scopes;
        }

        foreach (var (path, from) in plan.TargetLinks)
        {
            var bound = BoundScopes(Paths.ArrayScopes(path));
            foreach (var scope in RequiredScopes(from))
            {
                if (!bound.Contains(scope))
                    Error("unbound-scope", $"\"{path}\" reads from inside \"{scope}\", which repeats. Loop over it, or aggregate it with an aggregate operator.", path: path);
            }
        }
        foreach (var (to, record) in plan.RecordLinks)
        {
            // A record link fills its target whole, so nothing else may write inside it.
            foreach (var path in plan.TargetLinks.Keys.Concat(plan.RecordLinks.Keys).Concat(plan.LoopsByTarget.Keys).Where(p => p.StartsWith(to + ".", StringComparison.Ordinal)))
                Error("conflicting-link", $"\"{path}\" is inside \"{to}\", which a record link fills whole", path: path);
            var bound = BoundScopes(Paths.ArrayScopes(to));
            foreach (var scope in Paths.ArrayScopes(record.From))
            {
                if (!bound.Contains(scope))
                    Error("unbound-scope", $"\"{to}\" reads from inside \"{scope}\", which repeats. Loop over it first.", link: record.Link, path: to);
            }
            if (record.Submap is not { } name)
            {
                var missing = MissingFields(Paths.SchemaAt(document.Source, record.From)!, Paths.SchemaAt(document.Target, to)!, "");
                if (missing.Count > 0)
                    Warn("copy-mismatch", $"Link {record.Link} copies \"{record.From}\" as it is, but \"{to}\" has no {string.Join(", ", missing.Select(p => $"\"{p}\""))}. A sub-map can rename them.", link: record.Link, path: to);
                continue;
            }

            if (!context.Submaps.TryGetValue(name, out var submap))
            {
                Error("unknown-submap", $"Link {record.Link} maps \"{record.From}\" with sub-map \"{name}\", which the map doesn't have", link: record.Link, path: to);
                continue;
            }
            if (context.Stack.Contains(name))
            {
                Error("submap-cycle", $"Sub-map \"{name}\" uses itself, through {string.Join(" → ", context.Stack.Append(name).Select(n => $"\"{n}\""))}", link: record.Link, path: to);
                continue;
            }
            if (!context.Plans.ContainsKey(name))
            {
                var nested = Analyse(submap, registry, context with { Stack = [.. context.Stack, name] });
                context.Plans[name] = nested.Plan;
                if (context.Reported.Add(name))
                {
                    foreach (var issue in nested.Issues)
                        issues.Add(issue with { Message = $"In sub-map \"{name}\": {issue.Message}", Submap = issue.Submap ?? name });
                }
            }
            // The sub-map must fit the records it joins.
            var fromSchema = Paths.SchemaAt(document.Source, record.From)!;
            var toSchema = Paths.SchemaAt(document.Target, to)!;
            var (reads, writes) = PathsUsed(submap);
            foreach (var path in reads.Distinct())
            {
                if (Paths.SchemaAt(fromSchema, path) is null)
                    Error("submap-mismatch", $"Sub-map \"{name}\" reads \"{path}\", which \"{record.From}\" doesn't have", link: record.Link, path: to);
            }
            foreach (var path in writes.Distinct())
            {
                if (Paths.SchemaAt(toSchema, path) is null)
                    Error("submap-mismatch", $"Sub-map \"{name}\" writes \"{path}\", which \"{to}\" doesn't have", link: record.Link, path: to);
            }
        }

        // A required target field needs something mapped to it, wherever its record is being filled.
        var written = plan.TargetLinks.Keys.Concat(plan.RecordLinks.Keys).Concat(plan.LoopsByTarget.Keys).ToList();
        bool Fills(string path) => written.Any(w => w == path || w.StartsWith(path + ".", StringComparison.Ordinal) || w.StartsWith(path + "[]", StringComparison.Ordinal));
        bool InsideRecordLink(string path) => plan.RecordLinks.Keys.Any(r => path == r || path.StartsWith(r + ".", StringComparison.Ordinal));
        foreach (var (recordPath, record) in Records(document.Target, ""))
        {
            if ((recordPath.Length > 0 && !Fills(recordPath)) || InsideRecordLink(recordPath)) continue;
            foreach (var key in record.Required)
            {
                if (record.Property(key) is not { } child) continue;
                var path = Paths.Child(recordPath, key, child);
                if (!Fills(path)) Warn("required-unmapped", $"\"{path}\" is required by the target schema, but nothing maps to it", path: path);
            }
        }

        foreach (var scope in missingLoops)
        {
            Error("missing-loop", $"\"{scope}\" has mapped fields, but no loop says which source array it repeats over", path: scope);
        }

        var used = new HashSet<string>();
        void MarkUsed(LinkEnd from)
        {
            if (from.Node is not { } id || !used.Add(id)) return;
            if (nodes.TryGetValue(id, out var planned))
            {
                foreach (var input in planned.Inputs.Values) MarkUsed(input);
            }
        }
        foreach (var from in plan.TargetLinks.Values) MarkUsed(from);
        foreach (var id in nodes.Keys)
        {
            if (!used.Contains(id)) Warn("unused-node", $"\"{id}\" doesn't feed any target field", id);
        }

        return new MapAnalysis(issues, plan);
    }
}
