# Crosswalk.Core

Runs [Crosswalk](https://crosswalkjs.github.io/crosswalk/) maps in .NET. A Crosswalk map is a JSON-to-JSON mapping drawn in the browser with the Crosswalk editor and saved as plain JSON. This package loads one, checks it, and runs it on your data, synchronously or asynchronously.

```bash
dotnet add package Crosswalk.Core
```

```csharp
using System.Text.Json.Nodes;
using Crosswalk;

var transform = MapTransform.Create(File.ReadAllText("order-to-invoice.map.json")); // checks the map once

JsonObject invoice = transform.Run(JsonNode.Parse(orderJson));
```

Create a `MapTransform` once per map and reuse it. It's safe to run from many threads.

## Operators that wait

Your own operators are C#. One that has to wait, such as a lookup, is an `AsyncValueOperator`, and maps that use one run with `RunAsync`:

```csharp
var tier = new AsyncValueOperator
{
    Id = "acme.customerTier",
    Label = "Customer tier",
    Category = "acme",
    Inputs = new(1, 1),
    Run = async (args, cancellationToken) => await customers.GetTierAsync(Coerce.ToText(args[0]), cancellationToken),
};

var transform = MapTransform.Create(mapJson, new TransformOptions
{
    Registry = OperatorRegistry.Create(new RegistryOptions { Operators = [tier] }),
    Concurrency = 8, // async calls waiting at once, per run
});

JsonObject output = await transform.RunAsync(input, cancellationToken);
```

`registry.ToCatalog()` describes your operators as JSON, so the browser editor can offer exactly what your runtime can run.

It's the same map format, and the same behaviour, as the JavaScript packages: both pass the same conformance suite. Read the [documentation](https://crosswalkjs.github.io/crosswalk/docs/dotnet) for more.

Targets .NET 8 and later. MIT licensed.
