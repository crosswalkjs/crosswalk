using System.Collections.Immutable;
using System.Text.Json.Nodes;
using Crosswalk.Operators;

namespace Crosswalk;

/// <summary>How to check and run a map.</summary>
public sealed class TransformOptions
{
    /// <summary>The operators the map may use. Defaults to the built-ins.</summary>
    public OperatorRegistry? Registry { get; init; }

    /// <summary>How many async operator calls one run may have waiting at once. Defaults to 8.</summary>
    public int Concurrency { get; init; } = 8;

    /// <summary>Caps on the map and on each run. None by default; see <see cref="RunLimits.ForUserMaps"/>.</summary>
    public RunLimits Limits { get; init; } = RunLimits.None;
}

/// <summary>
/// Caps on what a map may do, for maps you didn't write yourself, such as ones users draw.
/// A null limit means no limit. The counting is defined by the conformance suite.
/// </summary>
public sealed record RunLimits
{
    /// <summary>The most operators a map may have. Checked when the transform is created.</summary>
    public int? MaxNodes { get; init; }

    /// <summary>The most links a map may have. Checked when the transform is created.</summary>
    public int? MaxLinks { get; init; }

    /// <summary>The most times operators may run in one run. Each runs once per item it's needed for.</summary>
    public int? MaxOperatorRuns { get; init; }

    /// <summary>The most values one run may write to the output: every field, object and array item, not counting the root.</summary>
    public int? MaxOutputValues { get; init; }

    /// <summary>The longest text an operator may produce, in UTF-16 code units.</summary>
    public int? MaxTextLength { get; init; }

    /// <summary>The longest a run may take.</summary>
    public TimeSpan? Timeout { get; init; }

    /// <summary>No limits.</summary>
    public static RunLimits None { get; } = new();

    /// <summary>Sensible limits for maps users draw: generous for real mappings, short of exhausting a server.</summary>
    public static RunLimits ForUserMaps { get; } = new()
    {
        MaxNodes = 500,
        MaxLinks = 2000,
        MaxOperatorRuns = 1_000_000,
        MaxOutputValues = 1_000_000,
        MaxTextLength = 1_000_000,
        Timeout = TimeSpan.FromSeconds(5),
    };
}

/// <summary>Thrown when a map or a run goes past one of its <see cref="RunLimits"/>.</summary>
public sealed class MapLimitException(string message, string limit, string? node = null) : Exception(message)
{
    /// <summary>Which limit, named as in JSON: <c>maxNodes</c>, <c>maxLinks</c>, <c>maxOperatorRuns</c>, <c>maxOutputValues</c>, <c>maxTextLength</c> or <c>timeout</c>.</summary>
    public string Limit { get; } = limit;

    /// <summary>The node that went past it, when there is one.</summary>
    public string? Node { get; } = node;

    internal static MapLimitException TimedOut(TimeSpan timeout) =>
        new($"The run took longer than the {timeout.TotalMilliseconds:0} ms allowed", "timeout");
}

/// <summary>Thrown when a map has errors, with every error found.</summary>
public sealed class MapValidationException(IReadOnlyList<MapIssue> issues)
    : Exception($"The map has {issues.Count} error{(issues.Count == 1 ? "" : "s")}:\n{string.Join("\n", issues.Select(i => $"- {i.Message}"))}")
{
    public IReadOnlyList<MapIssue> Issues { get; } = issues;
}

/// <summary>Thrown when an operator fails while a map runs, naming the node.</summary>
public sealed class MapRuntimeException(string message, string node, Exception inner) : Exception(message, inner)
{
    /// <summary>The id of the node whose operator failed.</summary>
    public string Node { get; } = node;
}

/// <summary>
/// A checked map, ready to run as many times as you like. Create one per map when it
/// loads, and reuse it: it's safe to run from several threads at once.
/// </summary>
public sealed class MapTransform
{
    private readonly MapPlan _plan;
    private readonly int _concurrency;
    private readonly RunLimits _limits;

    private MapTransform(MapPlan plan, int concurrency, RunLimits limits)
    {
        _plan = plan;
        _concurrency = concurrency;
        _limits = limits;
        // Sub-maps count too: a map is async if anything it runs is.
        AsyncNodes = plan.Submaps.Values.Prepend(plan).SelectMany(p => p.Nodes.Values).Where(n => n.Definition is AsyncValueOperator).Select(n => n.Node.Id).Distinct().ToList();
    }

    /// <summary>The nodes whose operators have to wait. When there are any, the map runs with <see cref="RunAsync(JsonNode, CancellationToken)"/> only.</summary>
    public IReadOnlyList<string> AsyncNodes { get; }

    /// <summary>True when the map uses async operators.</summary>
    public bool IsAsync => AsyncNodes.Count > 0;

    /// <summary>
    /// Checks a map and returns a transform for it. Throws a <see cref="MapValidationException"/>
    /// when the map has errors; warnings don't stop it.
    /// </summary>
    public static MapTransform Create(MapDocument document, TransformOptions? options = null)
    {
        options ??= new TransformOptions();
        if (options.Concurrency < 1) throw new ArgumentOutOfRangeException(nameof(options), $"Concurrency must be at least 1, not {options.Concurrency}");
        // Size first, so an oversized map isn't analysed at all.
        var limits = options.Limits;
        if (limits.MaxNodes is { } maxNodes && document.Nodes.Count > maxNodes)
            throw new MapLimitException($"The map has {document.Nodes.Count} operators, more than the {maxNodes} allowed", "maxNodes");
        if (limits.MaxLinks is { } maxLinks && document.Links.Count > maxLinks)
            throw new MapLimitException($"The map has {document.Links.Count} links, more than the {maxLinks} allowed", "maxLinks");
        var analysis = MapAnalyser.Analyse(document, options.Registry);
        var errors = analysis.Errors.ToList();
        if (errors.Count > 0) throw new MapValidationException(errors);
        return new MapTransform(analysis.Plan, options.Concurrency, limits);
    }

    /// <summary>Reads a map from the JSON the editor saves, checks it and returns a transform for it.</summary>
    public static MapTransform Create(string mapJson, TransformOptions? options = null) => Create(MapDocument.Parse(mapJson), options);

    /// <summary>
    /// Runs the map. Throws <see cref="InvalidOperationException"/> if the map uses async
    /// operators, which need <see cref="RunAsync(JsonNode, CancellationToken)"/>, and <see cref="MapRuntimeException"/>
    /// if an operator fails on the data.
    /// </summary>
    public JsonObject Run(JsonNode? input)
    {
        if (IsAsync)
        {
            throw new InvalidOperationException($"This map uses async operators, so run it with RunAsync: {string.Join(", ", AsyncNodes.Select(id => $"\"{id}\""))}");
        }
        // With no async operators every step completes synchronously.
        var run = new Evaluator(_plan, input, CancellationToken.None, limit: null, new RunState(_limits)).Run();
        if (!run.IsCompleted) throw new InvalidOperationException("A synchronous run didn't complete synchronously");
        return run.GetAwaiter().GetResult();
    }

    /// <summary>Runs the map on JSON text.</summary>
    public JsonObject Run(string inputJson) => Run(JsonNode.Parse(inputJson));

    /// <summary>
    /// Runs the map, waiting for async operators. Works for every map. Cancelling the token
    /// stops the run with an <see cref="OperationCanceledException"/>, and async operators get it too.
    /// </summary>
    public async ValueTask<JsonObject> RunAsync(JsonNode? input, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var limit = new SemaphoreSlim(_concurrency);
        // A timeout also cancels waiting operators, not just the steps between them.
        using var timeout = _limits.Timeout is { } after ? new CancellationTokenSource(after) : null;
        using var linked = timeout is null ? null : CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        try
        {
            return await new Evaluator(_plan, input, linked?.Token ?? cancellationToken, limit, new RunState(_limits)).Run().ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (timeout?.IsCancellationRequested == true && !cancellationToken.IsCancellationRequested)
        {
            throw MapLimitException.TimedOut(_limits.Timeout!.Value);
        }
    }

    /// <summary>Runs the map on JSON text, waiting for async operators.</summary>
    public ValueTask<JsonObject> RunAsync(string inputJson, CancellationToken cancellationToken = default) =>
        RunAsync(JsonNode.Parse(inputJson), cancellationToken);
}

/// <summary>
/// Builds the target for one run. Every step returns a <see cref="ValueTask{T}"/> that's
/// already complete unless an async operator is waiting, so a map without async operators
/// runs synchronously, and both kinds of run share the same rules.
/// </summary>
/// <summary>What a run's map and its sub-maps share: the limits, their counters, and the groups made so far.</summary>
internal sealed class RunState(RunLimits limits)
{
    public RunLimits Limits { get; } = limits;
    public long? Deadline { get; } = limits.Timeout is { } timeout ? Environment.TickCount64 + (long)timeout.TotalMilliseconds : null;
    public int OperatorRuns;
    public int OutputValues;

    // Groups made by grouped loops in this run, by id. A grouped item's bindings carry its
    // group's id under "<scope>#group", next to the index of its first item.
    public System.Collections.Concurrent.ConcurrentDictionary<int, int[]> Groups { get; } = new();
    public int NextGroup;
}

internal sealed class Evaluator(MapPlan plan, JsonNode? input, CancellationToken cancellationToken, SemaphoreSlim? limit, RunState state)
{
    private readonly RunLimits limits = state.Limits;

    private static string GroupBinding(string scope) => $"{scope}#group";

    /// <summary>Counts a value written to the output.</summary>
    private void Placed()
    {
        if (limits.MaxOutputValues is { } max && Interlocked.Increment(ref state.OutputValues) > max)
            throw new MapLimitException($"The run wrote more than the {max} output values allowed", "maxOutputValues");
    }

    /// <summary>Checks an operator's text output against the limit.</summary>
    private Value CheckText(Value value, string id)
    {
        if (limits.MaxTextLength is { } max && value.Node is JsonValue text && text.GetValueKind() == System.Text.Json.JsonValueKind.String)
        {
            var length = text.GetValue<string>().Length;
            if (length > max) throw new MapLimitException($"\"{id}\" produced {length} characters of text, more than the {max} allowed", "maxTextLength", id);
        }
        return value;
    }

    /// <summary>The index of the current item of each source array being repeated over.</summary>
    private static readonly ImmutableDictionary<string, int> NoBindings = ImmutableDictionary<string, int>.Empty;

    public async ValueTask<JsonObject> Run()
    {
        var output = await Build(plan.Document.Target, "", NoBindings).ConfigureAwait(false);
        return output.Node as JsonObject ?? [];
    }

    /// <summary>Reads a source path. With <paramref name="whole"/>, a path ending in [] gives the whole array rather than the current item.</summary>
    private Value Read(string path, ImmutableDictionary<string, int> bindings, bool whole = false)
    {
        var segments = Paths.Parse(path);
        var current = input;
        var prefix = "";
        for (var position = 0; position < segments.Length; position++)
        {
            var segment = segments[position];
            if (current is not JsonObject obj || !obj.TryGetPropertyValue(segment.Key, out var next)) return Value.Absent;
            current = next;
            prefix = prefix.Length == 0 ? Paths.EscapeKey(segment.Key) : $"{prefix}.{Paths.EscapeKey(segment.Key)}";
            if (!segment.Array) continue;
            prefix += "[]";
            if (current is not JsonArray array) return Value.Absent;
            if (whole && position == segments.Length - 1) return Value.Of(array);
            // The analyser guarantees every array a read passes through has a current item.
            var index = bindings.TryGetValue(prefix, out var i) ? i : throw new InvalidOperationException($"No current item for \"{prefix}\"");
            if (index >= array.Count) return Value.Absent;
            current = array[index];
        }
        return Value.Of(current);
    }

    private ValueTask<Value> Evaluate(LinkEnd from, ImmutableDictionary<string, int> bindings) =>
        from.Source is { } path ? new(Read(path, bindings)) : Remembered(from.Node!, bindings);

    /// <summary>
    /// Each node's result for each item, so an operator that feeds several fields runs once
    /// per item, not once per field: a lookup isn't repeated.
    /// </summary>
    private readonly Dictionary<string, ValueTask<Value>> _results = [];

    private ValueTask<Value> Remembered(string id, ImmutableDictionary<string, int> bindings)
    {
        var key = bindings.IsEmpty ? id : $"{id}|{string.Join(";", bindings.OrderBy(b => b.Key, StringComparer.Ordinal).Select(b => $"{b.Key}={b.Value}"))}";
        lock (_results)
        {
            if (_results.TryGetValue(key, out var known)) return known;
            // Preserve lets the same result be awaited by every field that reads it.
            var result = EvaluateNode(id, bindings).Preserve();
            _results[key] = result;
            return result;
        }
    }

    private ValueTask<Value> Input(PlannedNode planned, int index, ImmutableDictionary<string, int> bindings)
    {
        if (planned.Inputs.TryGetValue(index, out var link)) return Evaluate(link, bindings);
        return new(planned.Constants.TryGetValue(index, out var constant) ? Value.Of(constant) : Value.Absent);
    }

    /// <summary>Starts every task before waiting on any, so independent async operators overlap.</summary>
    private static async ValueTask<Value[]> All(ValueTask<Value>[] tasks)
    {
        var results = new Value[tasks.Length];
        for (var i = 0; i < tasks.Length; i++) results[i] = await tasks[i].ConfigureAwait(false);
        return results;
    }

    private async ValueTask<Value> EvaluateNode(string id, ImmutableDictionary<string, int> bindings)
    {
        var planned = plan.Nodes[id];
        var definition = planned.Definition;
        try
        {
            if (limits.MaxOperatorRuns is { } maxRuns && Interlocked.Increment(ref state.OperatorRuns) > maxRuns)
                throw new MapLimitException($"The run needed more than the {maxRuns} operator runs allowed", "maxOperatorRuns", id);
            if (state.Deadline is { } deadline && Environment.TickCount64 > deadline) throw MapLimitException.TimedOut(limits.Timeout!.Value);

            if (definition is AggregateOperator aggregate)
            {
                var scope = planned.Node.Scope!;
                var values = new List<JsonNode?>();
                if (Read(scope, bindings, whole: true).Node is JsonArray items)
                {
                    // Inside a grouped loop over this array, an aggregate covers the current group.
                    var members = bindings.TryGetValue(GroupBinding(scope), out var group) ? state.Groups[group] : Enumerable.Range(0, items.Count).ToArray();
                    var each = members.Select(i => Input(planned, 0, bindings.SetItem(scope, i))).ToArray();
                    foreach (var value in await All(each).ConfigureAwait(false))
                    {
                        if (!value.IsAbsent) values.Add(value.Node);
                    }
                }
                return CheckText(aggregate.Reduce(values), id);
            }

            var args = await All(Enumerable.Range(0, planned.InputCount).Select(i => Input(planned, i, bindings)).ToArray()).ConfigureAwait(false);
            if (!definition.HandlesAbsent && args.Any(arg => arg.IsAbsent)) return Value.Absent;
            if (definition is ValueOperator immediate) return CheckText(immediate.Run(args), id);

            var waiting = (AsyncValueOperator)definition;
            cancellationToken.ThrowIfCancellationRequested();
            if (limit is null) return CheckText(await waiting.Run(args, cancellationToken).ConfigureAwait(false), id);
            await limit.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                return CheckText(await waiting.Run(args, cancellationToken).ConfigureAwait(false), id);
            }
            finally
            {
                limit.Release();
            }
        }
        catch (MapRuntimeException)
        {
            throw;
        }
        catch (MapLimitException)
        {
            throw;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // A cancelled run stops as cancelled, not as the operator's fault.
            throw;
        }
        catch (Exception error)
        {
            throw new MapRuntimeException($"\"{id}\" ({definition.Label}) failed: {error.Message}", id, error);
        }
    }

    /// <summary>Sorts present values by <see cref="Coerce.Compare"/>, flipped for descending; missing values, absent or null, go last either way.</summary>
    private static int CompareForSort(Value a, Value b, bool descending)
    {
        bool missingA = a.IsAbsent || a.IsNull, missingB = b.IsAbsent || b.IsNull;
        if (missingA || missingB) return missingA == missingB ? 0 : missingA ? 1 : -1;
        var result = Coerce.Compare(a, b);
        return descending ? -result : result;
    }

    /// <summary>A group's key: values that compare equal share one, so "1" and 1 group together.</summary>
    private static string GroupKey(Value value) =>
        value.IsAbsent ? "absent" : Coerce.IsNumeric(value) ? $"number:{Coerce.NumberToText(Coerce.ToNumber(value))}" : $"text:{Coerce.ToText(value)}";

    /// <summary>JSON with object keys sorted, so equal values have equal text whatever their key order.</summary>
    private static string Canonical(JsonNode? node) => node switch
    {
        null => "null",
        JsonArray array => $"[{string.Join(",", array.Select(Canonical))}]",
        JsonObject obj => $"{{{string.Join(",", obj.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => $"{JsonValue.Create(p.Key).ToJsonString()}:{Canonical(p.Value)}"))}}}",
        _ when Coerce.NumberIn(node) is { } number => Coerce.NumberToText(number),
        _ => node.ToJsonString(),
    };

    /// <summary>A node can only sit in one place in a JSON tree, so values from the input or the map are copied.</summary>
    private static JsonNode? Place(JsonNode? node) => node is null || node.Parent is null ? node : node.DeepClone();

    /// <summary>Counts every value inside a record copied whole, as each is written to the output.</summary>
    private void PlacedWithin(JsonNode? node)
    {
        IEnumerable<JsonNode?> children = node switch
        {
            JsonObject obj => obj.Select(p => p.Value),
            JsonArray array => array,
            _ => [],
        };
        foreach (var child in children)
        {
            Placed();
            PlacedWithin(child);
        }
    }

    private async ValueTask<Value> Build(Schema schema, string path, ImmutableDictionary<string, int> bindings)
    {
        // A record link fills the whole target record: a copy of the source record, or a sub-map's
        // output for it. An array and its items share a path, so it applies at the record: each item, in a loop.
        if (schema.Type == "object" && plan.RecordLinks.TryGetValue(path, out var record))
        {
            var source = Read(record.From, bindings);
            if (source.IsAbsent) return Value.Absent;
            if (record.Submap is null)
            {
                PlacedWithin(source.Node);
                return Value.Of(source.Node?.DeepClone());
            }
            var output = await new Evaluator(plan.Submaps[record.Submap], source.Node, cancellationToken, limit, state).Run().ConfigureAwait(false);
            // An empty result is left out, like any object with nothing mapped into it.
            return output.Count == 0 ? Value.Absent : Value.Of(output);
        }

        if (schema.Type == "object")
        {
            var properties = schema.Properties;
            var values = await All(properties.Select(p => Build(p.Value, Paths.Child(path, p.Key, p.Value), bindings)).ToArray()).ConfigureAwait(false);
            var result = new JsonObject();
            for (var i = 0; i < values.Length; i++)
            {
                if (values[i].IsAbsent) continue;
                Placed();
                result[properties[i].Key] = Place(values[i].Node);
            }
            // An object with nothing mapped into it is left out, as is an array item,
            // so gating every field of an item filters it.
            return result.Count == 0 ? Value.Absent : Value.Of(result);
        }
        if (schema.Type == "array")
        {
            if (!plan.LoopsByTarget.TryGetValue(path, out var loop) || schema.Items is not { } itemSchema) return Value.Absent;
            if (Read(loop.Source, bindings, whole: true).Node is not JsonArray items) return Value.Absent;
            ImmutableDictionary<string, int> At(int index) => bindings.SetItem(loop.Source, index);

            IEnumerable<int> order = Enumerable.Range(0, items.Count);
            if (loop.SortBy.Count > 0)
            {
                var keys = order.ToDictionary(i => i, i => loop.SortBy.Select(key => Read(key.Path, At(i))).ToArray());
                // OrderBy is stable, as the sort must be.
                order = order.OrderBy(i => i, Comparer<int>.Create((a, b) =>
                {
                    for (var k = 0; k < loop.SortBy.Count; k++)
                    {
                        var result = CompareForSort(keys[a][k], keys[b][k], loop.SortBy[k].Descending);
                        if (result != 0) return result;
                    }
                    return 0;
                })).ToList();
            }

            var groups = order.Select(i => new[] { i }).ToList();
            if (loop.GroupBy is { } groupBy)
            {
                var byKey = new Dictionary<string, List<int>>();
                var keyOrder = new List<string>();
                foreach (var i in order)
                {
                    var key = GroupKey(Read(groupBy, At(i)));
                    if (!byKey.TryGetValue(key, out var members)) { byKey[key] = members = []; keyOrder.Add(key); }
                    members.Add(i);
                }
                groups = keyOrder.Select(key => byKey[key].ToArray()).ToList();
            }

            var tasks = groups.Select(members =>
            {
                var itemBindings = At(members[0]);
                if (loop.GroupBy is not null)
                {
                    var id = Interlocked.Increment(ref state.NextGroup);
                    state.Groups[id] = members;
                    itemBindings = itemBindings.SetItem(GroupBinding(loop.Source), id);
                }
                return Build(itemSchema, path, itemBindings);
            }).ToArray();
            var values = await All(tasks).ConfigureAwait(false);
            var result = new JsonArray();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var value in values)
            {
                if (value.IsAbsent) continue;
                if (loop.Distinct && !seen.Add(Canonical(value.Node))) continue;
                Placed();
                result.Add(Place(value.Node));
            }
            return Value.Of(result);
        }
        return plan.TargetLinks.TryGetValue(path, out var from) ? await Evaluate(from, bindings).ConfigureAwait(false) : Value.Absent;
    }
}
