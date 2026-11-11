---
title: Running maps in .NET
description: Crosswalk.Core runs Crosswalk maps in a .NET app.
---

# Running maps in .NET

`Crosswalk.Core` runs Crosswalk maps in .NET 8 and later. It reads the same map JSON the editor saves and behaves exactly like the JavaScript core: both pass the same [conformance suite](https://github.com/crosswalkjs/crosswalk/tree/main/conformance).

```bash
dotnet add package Crosswalk.Core
```

## Run a map

```csharp
using System.Text.Json.Nodes;
using Crosswalk;

var transform = MapTransform.Create(File.ReadAllText("order-to-invoice.map.json"));

JsonObject invoice = transform.Run(JsonNode.Parse(orderJson));
```

`MapTransform.Create` checks the map once and throws a `MapValidationException` listing every error. Create one per map when it loads and reuse it: it's safe to run from many threads at once.

A run that fails on the data, such as text where an operator needs a number, throws a `MapRuntimeException` whose `Node` names the operator that failed.

## A typical setup

Designers draw maps in the browser with the editor, your API stores them, and your .NET app runs them when it needs to. The map JSON is the only thing the two sides share.

```csharp
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var registry = OperatorRegistry.Create(new RegistryOptions { Operators = [customerTier] });

// The editor builds its toolbox from this, so it only offers what this runtime can run.
app.MapGet("/crosswalk/operators", () => registry.ToCatalog());

// The editor's live preview, with this runtime's operators.
app.MapPost("/crosswalk/preview", (JsonNode request, CancellationToken cancellationToken) =>
    CrosswalkPreview.HandleAsync(request, registry, cancellationToken));

// Never trust a map from the browser: check it before storing it.
app.MapPut("/maps/{id}", async (string id, JsonNode body, IMapStore store) =>
{
    var map = MapDocument.FromJson(body);
    var errors = MapAnalyser.Analyse(map, registry).Errors.ToList();
    if (errors.Count > 0) return Results.ValidationProblem(errors.GroupBy(e => e.Code).ToDictionary(g => g.Key, g => g.Select(e => e.Message).ToArray()));
    await store.SaveAsync(id, body);
    return Results.NoContent();
});

// Run a stored map on demand.
app.MapPost("/maps/{id}/run", async (string id, JsonNode input, IMapStore store, CancellationToken cancellationToken) =>
{
    var transform = MapTransform.Create(MapDocument.FromJson(await store.LoadAsync(id)), new TransformOptions { Registry = registry });
    return Results.Ok(await transform.RunAsync(input, cancellationToken));
});

app.Run();
```

In a real app, cache the `MapTransform` per map version rather than creating one per request. [Connecting to a server](./editor/server.md) covers the browser side of the catalogue and preview endpoints.

## Your own operators

Custom operators are C#. The editor learns about them from the server's catalogue, so they're written once, here. [Where your operators run](./operators/custom-operators.md#where-your-operators-run) covers the choices.

Give each the same `Id` the map uses:

```csharp
using Crosswalk.Operators;

var initials = new ValueOperator
{
    Id = "acme.initials",
    Label = "Initials",
    Category = "text",
    Inputs = new(1, 1, ["name"]),
    Run = args => string.Concat(Coerce.ToText(args[0]).Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(w => char.ToUpperInvariant(w[0]))),
};

var registry = OperatorRegistry.Create(new RegistryOptions
{
    Builtins = op => op.Category != "math", // or leave it out for every built-in
    Categories = [new CategoryDefinition("acme", "Acme", "#ff3366")],
    Operators = [initials],
});
```

- **Inputs** arrive as `Value`s. A `Value` is a JSON node, JSON `null`, or `Value.Absent` for no value. Return `Value.Absent` to leave the target field out. Strings, numbers and booleans convert to `Value` implicitly.
- **`Coerce`** reads inputs the way the built-ins do: `ToText`, `ToNumber`, `ToBoolean`, `IsNumeric` and `Compare`. Using it keeps your operators consistent with the rest of the map.
- **Throw an `OperatorException`** for input that doesn't make sense. The run fails with a `MapRuntimeException` naming the node.
- **`AggregateOperator`** reduces one input across a repeating record, with a `Reduce` that gets every item's value.
- **`OperatorInputs`** takes the input count, labels, and `Tables`: the inputs that take a table of keys and values, such as `new(2, 3, ["value", "table", "if not found"], [1])`. The editor offers a table on those inputs, through the catalogue.

### Operators that wait

An operator that has to wait, such as a lookup in a database or another service, is an `AsyncValueOperator`. Maps that use one run with `RunAsync`:

```csharp
var customerTier = new AsyncValueOperator
{
    Id = "acme.customerTier",
    Label = "Customer tier",
    Category = "acme",
    Inputs = new(1, 1, ["customer id"]),
    Run = async (args, cancellationToken) => await customers.GetTierAsync(Coerce.ToText(args[0]), cancellationToken),
};

var transform = MapTransform.Create(map, new TransformOptions { Registry = registry, Concurrency = 8 });
JsonObject output = await transform.RunAsync(input, cancellationToken);
```

- `Run` on a map with async operators throws an `InvalidOperationException` naming them. `transform.IsAsync` tells you which you need.
- **`Concurrency`** caps how many async calls one run has waiting at once, 8 by default.
- **Cancelling the token** stops the run with an `OperationCanceledException`, and each async operator gets the token to stop its own work.
- An operator runs **once per item**, however many fields it feeds, so a lookup isn't repeated.

## XML

To take and produce XML, convert at the edges with `XmlJson`, by the map's own schemas. It reads and writes exactly as the JavaScript runtime does; [XML](./maps/xml.mdx) describes how.

```csharp
var map = MapDocument.Parse(File.ReadAllText("order-to-invoice.map.json"));
var transform = MapTransform.Create(map);

var input = XmlJson.Read(orderXml, map.Source);
var invoiceXml = XmlJson.Write(transform.Run(input), map.Target);
```

`XmlJson.Write` also takes `root`, `indent` and `declaration`. A DOCTYPE is ignored and its entities never expanded.

## Flat files

CSV and fixed-width files convert the same way, with `FlatFile`, by the map's schemas and their `flat` settings. [Flat files](./maps/flat-files.mdx) describes how.

```csharp
var input = FlatFile.Read(File.ReadAllText("payments.csv"), map.Source);
File.WriteAllText("bank.txt", FlatFile.Write(transform.Run(input), map.Target));
```

## Limits

For maps users draw, cap what a run may do:

```csharp
var transform = MapTransform.Create(map, new TransformOptions
{
    Registry = registry,
    Limits = RunLimits.ForUserMaps with { Timeout = TimeSpan.FromSeconds(2) },
});
```

`RunLimits` has `MaxNodes`, `MaxLinks`, `MaxOperatorRuns`, `MaxOutputValues`, `MaxTextLength` and `Timeout`, with the same meaning and the same counting as in JavaScript (see [Limits](./maps/how-maps-run.md#limits)). Going past one throws a `MapLimitException` whose `Limit` names it, such as `"maxOperatorRuns"`. A timeout is a `MapLimitException` too, not an `OperationCanceledException`; your own cancellation token still cancels as usual.

`CrosswalkPreview.HandleAsync` applies `RunLimits.ForUserMaps` unless you pass other limits.

## Checking a map

```csharp
var analysis = MapAnalyser.Analyse(map, registry);
foreach (var issue in analysis.Issues)
    Console.WriteLine($"{issue.Severity} {issue.Code}: {issue.Message}");
```

The issue codes are the same as the JavaScript ones, listed under [Validation](./maps/how-maps-run.md#validation).

## Differences from the JavaScript API

The behaviour is identical; only the names follow .NET conventions.

| JavaScript | .NET |
|---|---|
| `createTransform(map)(input)` | `MapTransform.Create(map).Run(input)` |
| `createAsyncTransform(map)(input, { signal })` | `MapTransform.Create(map).RunAsync(input, cancellationToken)` |
| `analyseMap(map, registry)` | `MapAnalyser.Analyse(map, registry)` |
| `createRegistry({ builtins, operators, categories })` | `OperatorRegistry.Create(new RegistryOptions { ... })` |
| `defineOperator({ kind: "value", run })` | `new ValueOperator { Run = ... }` |
| `ABSENT` | `Value.Absent` |
| `AbortSignal` | `CancellationToken` |
| `limitsForUserMaps`, `MapLimitError` | `RunLimits.ForUserMaps`, `MapLimitException` |
