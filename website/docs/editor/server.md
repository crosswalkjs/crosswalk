---
title: Connecting to a server
description: Give the editor your server's operators, and preview maps on the server.
---

# Connecting to a server

A common setup: designers draw maps in the browser, your API stores them, and a server runs them, in [.NET](../dotnet.md) or Node. The editor needs two things from that server:

1. **Its operators,** so the toolbox offers exactly what the server can run, including your own.
2. **A preview,** so designers see real output while they draw, even from operators that only exist on the server, such as a lookup in your database.

## The server's operators

The server describes its operators as a **catalogue**: JSON with each operator's id, label, category and inputs, but no code.

```csharp
// .NET
app.MapGet("/crosswalk/operators", () => registry.ToCatalog());
```

```ts
// Node
app.get("/crosswalk/operators", (req, res) => res.json(registry.toCatalog()));
```

In the browser, `registryFromCatalog` turns it into a registry for the editor:

```ts
import { registryFromCatalog } from "@crosswalkjs/core";
import { createMapper } from "@crosswalkjs/canvas";

const catalog = await fetch("/crosswalk/operators").then((response) => response.json());
const registry = registryFromCatalog(catalog);

createMapper(element, { document: map, registry });
```

Built-in operators keep their browser implementations, because every runtime runs them the same way. The server's own operators are marked `remote`: the toolbox offers them and maps using them are checked, but they only run on the server. If you also have a browser implementation of one, pass it as `registryFromCatalog(catalog, { local: [...] })`.

## Live preview

Give the editor a sample input and it shows each target field's value next to its name, updated a moment after every edit:

```ts
createMapper(element, {
  document: map,
  registry,
  preview: { input: sampleOrder },
});
```

A field the map leaves out shows "left out", and a repeating field shows how many items it has. Fields inside a repeating field show the first item's value. If an operator fails on the sample, it's ringed in red and a note says why. Call `mapper.setPreviewInput(next)` to change the sample, or pass `undefined` to turn the preview off.

By default the preview runs in the browser. A map that uses server-only operators can't run there, so the editor says so and asks for a **preview runner**. Point one at your server:

```ts
import { createMapper, previewOverHttp } from "@crosswalkjs/canvas";

createMapper(element, {
  document: map,
  registry,
  preview: {
    input: sampleOrder,
    run: previewOverHttp("/crosswalk/preview", { headers: { authorization: `Bearer ${token}` } }),
  },
});
```

The server side is a couple of lines:

```csharp
// .NET
app.MapPost("/crosswalk/preview", (JsonNode request, CancellationToken cancellationToken) =>
    CrosswalkPreview.HandleAsync(request, registry, cancellationToken));
```

```ts
// Node
import { handlePreview } from "@crosswalkjs/core";

app.post("/crosswalk/preview", async (req, res) => res.json(await handlePreview(req.body, { registry })));
```

The editor waits a moment after each edit before asking, and cancels a request still in flight when there's a newer edit, so typing quickly doesn't flood the server. Each request runs the whole map once, with your operators, so treat the endpoint like any other: authenticate it, and use a sample input rather than live data if the operators have side effects.

Both handlers apply the [limits for user maps](../maps/how-maps-run.md#limits) unless you pass your own, so a preview of a runaway map stops rather than tying up the server. When a limit stops one, the editor shows why.

### The preview protocol

If your server isn't .NET or Node, the protocol is small. `previewOverHttp` posts:

```json
{ "map": { "...": "the map being drawn" }, "input": { "...": "the sample input" } }
```

and expects exactly one of:

| Response | When |
|---|---|
| `{ "output": { ... } }` | The map ran. |
| `{ "issues": [{ "severity", "code", "message", "node"?, "path"? }] }` | The map has errors, so it didn't run. |
| `{ "error": { "message", "node"?, "limit"? } }` | An operator failed on the input, or a [limit](../maps/how-maps-run.md#limits) stopped the run. `node` is the one to highlight; `limit` names the limit. |

You can also write your own runner, any function `(request, { signal }) => Promise<response>`, to send the preview over a WebSocket or through an existing API client.
