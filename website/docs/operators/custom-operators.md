---
title: Your own operators
description: Choose which built-in operators are available, and add your own.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import Sandbox from '@site/src/components/Sandbox';

# Your own operators

The operators a map can use, and the editor shows in its toolbox, come from a **registry**. `createRegistry()` with no options gives you every [built-in operator](./reference.mdx). Pass the same registry to the editor and to `createTransform`.

```ts
import { createRegistry, createTransform } from "@crosswalkjs/core";
import { createMapper } from "@crosswalkjs/canvas";

const registry = createRegistry({ /* options below */ });

createMapper(element, { document: map, registry });
const run = createTransform(map, { registry });
```

## Choosing the built-ins

```ts
createRegistry(); // all of them, the default
createRegistry({ builtins: false }); // none
createRegistry({ builtins: (operator) => operator.category !== "math" }); // everything except Math
createRegistry({ builtins: (operator) => ["text.concat", "flow.onlyIf"].includes(operator.id) });
```

To take one out after the fact, use `registry.unregister("text.replace")`. A map that still uses it then reports an `unknown-operator` issue instead of failing to load.

Here the registry leaves out the Text operators, so the toolbox has none. Change the filter and the toolbox follows, and leave out Math to see what a map that needs a missing operator does:

<Sandbox example="builtins" height={380} />

## Adding an operator

A **value** operator works out one value from its inputs. Change what `run` returns and the output follows:

<Sandbox example="custom-operator" height={480} />


| Field | What it's for |
|---|---|
| `id` | How maps refer to it. Namespace your own, such as `acme.initials`, so they can't clash with built-ins. |
| `label`, `description` | Shown in the toolbox and the inspector. |
| `glyph` | A few characters drawn on the tile. Defaults to the start of the label. |
| `category` | Which toolbox group it goes in. |
| `inputs` | How many inputs it takes: `min`, an optional `max` (leave it out for no limit), and optional `labels` shown in the inspector. `tables` lists the inputs that take a table of keys and values, such as `[1]` for Look up's second input, so the inspector offers a table there. |
| `run(args)` | Works out the value. `args` holds one value per input, in order. |
| `handlesAbsent` | Leave it out normally: an input with no value then makes the output empty without calling `run`. Set it to `true` to see missing inputs yourself, as **Exists** does. |

Return `ABSENT` (exported from the core package) to leave the target field out, as **Only if** does. Throw an `OperatorError` for input that doesn't make sense; the editor and `MapRuntimeError` report it against the node.

The core package exports the helpers the built-ins use for reading inputs: `toText`, `toNumber` (which throws on text that isn't a number), `toBoolean`, `isNumeric` and `compare`.

### Operators that wait

Some operators have to wait for their value, such as a lookup in a database or another service. Mark them `async: true` and return a promise. They get a second argument with a `signal` to pass on, so a cancelled run stops their work too:

<Sandbox example="async-operator" height={480} />


A map that uses one runs with [`createAsyncTransform`](../maps/how-maps-run.md#operators-that-wait) rather than `createTransform`. Aggregate operators are always synchronous, but their input can come from an async operator.

Inside a loop, an async operator is called once per item. If many items share the same input, such as one exchange rate for a whole order, cache inside `run` so you don't fetch it again for every item.

### Aggregate operators

An **aggregate** operator reduces one input across every item of a repeating record:

<Sandbox example="aggregate-operator" height={480} />


`reduce` gets the input's value for each item, with missing values already dropped.

## Categories

Categories are the groups in the toolbox, shown in the order they're registered. An operator whose category isn't registered gets one automatically, labelled with its id. To give it a proper label and a colour:

<Sandbox example="categories" height={380} />


- A category's `color` is used unless the active theme sets one for it. [Themes](../themes/custom-themes.md) can set colours for your categories too.
- Registering a category with a built-in's id relabels or recolours that one: `{ id: "text", label: "Strings" }`.
- Category ids become CSS class names, so they start with a letter and use only letters, digits, `-` and `_`.

## Where your operators run

An operator has to exist wherever a map using it runs, with the same id and the same behaviour. A map only stores the operator's id, so which code that id runs is up to each runtime. Where that is decides where you write it:

| Maps run | Write the operator in | The editor gets it from |
|---|---|---|
| Only in the browser | TypeScript | `createRegistry`, as above. |
| On a Node server | TypeScript, in one module the browser and the server both import | `createRegistry`, the same on both sides. |
| On a [.NET server](../dotnet.md#your-own-operators) | C# | The server's catalogue, with `registryFromCatalog`. See [From your server](#from-your-server). |

For a .NET server, the C# operator is the only one. The browser learns its id, label and inputs from the server's catalogue, so the toolbox offers it and maps using it are checked, and a [preview runner](../editor/server.md#live-preview) runs it on the server while the map is drawn. Nothing needs writing twice.

Write a browser version as well only when maps must also run in the browser, such as offline. Pass it as `registryFromCatalog(catalog, { local: [initials] })`. To keep the two versions the same, write the cases down once, as a JSON list of inputs and the output each should give, and have both test suites run them. That's how the built-in operators stay the same in both runtimes.

Maps are saved and outlive the code that runs them. Once a map uses an operator, changing what it does changes every saved map that uses it. For a change in behaviour, add an operator with a new id, such as `acme.initials.v2`, and leave the old one for the maps that use it. A runtime that's missing an operator a map uses reports `unknown-operator` before running anything, so a map is never half run.

## In your framework

Make the registry once, in a module of its own, and import it wherever it's needed:

```ts title="crosswalk.ts"
import { createRegistry, defineCategory } from "@crosswalkjs/core";
import { initials } from "./operators/initials";

export const acme = defineCategory({ id: "acme", label: "Acme", color: "#ff3366" });
export const registry = createRegistry({ categories: [acme], operators: [initials] });
```

Each [framework's](../frameworks/overview.md) editor component takes it as `registry`. The editor reads it once, when it's created. To run maps in the browser too, pass the same registry to `createTransform(map, { registry })`.

<Tabs groupId="framework" queryString lazy>
<TabItem value="react" label="React">

```tsx
import { MapEditor } from "./MapEditor";
import { registry } from "./crosswalk";

<MapEditor map={map} registry={registry} onChange={setMap} />
```

</TabItem>
<TabItem value="vue" label="Vue">

```vue
<script setup lang="ts">
import MapEditor from "./MapEditor.vue";
import { registry } from "./crosswalk";
</script>

<template>
  <MapEditor :map="map" :registry="registry" @change="save" />
</template>
```

Keep the registry out of `ref()` and `reactive()`. A deep ref wraps it in a proxy, and the registry's private fields don't work through one. Import it as above, or hold it in a `shallowRef`.

</TabItem>
<TabItem value="svelte" label="Svelte">

```svelte
<script lang="ts">
  import MapEditor from "./MapEditor.svelte";
  import { registry } from "./crosswalk";
</script>

<MapEditor {map} {registry} onchange={save} />
```

</TabItem>
<TabItem value="angular" label="Angular">

```ts
import { registry } from "./crosswalk";

@Component({
  imports: [MapEditorComponent],
  template: `<app-map-editor [map]="startingMap" [registry]="registry" (mapChange)="save($event)" />`,
})
export class MapPageComponent {
  readonly registry = registry;
  // ...
}
```

</TabItem>
<TabItem value="solid" label="Solid">

```tsx
import { MapEditor } from "./MapEditor";
import { registry } from "./crosswalk";

<MapEditor map={map} registry={registry} onChange={save} />
```

</TabItem>
<TabItem value="astro" label="Astro">

```astro
<div id="mapper" data-map={JSON.stringify(map)} style="height: 600px"></div>

<script>
  import { createMapper } from "@crosswalkjs/canvas";
  import { registry } from "../crosswalk";

  const element = document.getElementById("mapper")!;
  createMapper(element, { document: JSON.parse(element.dataset.map!), registry });
</script>
```

With a framework component and `client:only`, the registry can't be passed from the page's frontmatter, since it isn't plain JSON. Import it in the component, or in a small wrapper component, instead.

</TabItem>
<TabItem value="web-components" label="Web Components">

```ts
import { registry } from "./crosswalk";

const editor = document.createElement("crosswalk-editor") as CrosswalkEditor;
editor.map = startingMap;
editor.registry = registry;
document.body.append(editor);
```

In Lit, bind it as a property: `<crosswalk-editor .map=${this.map} .registry=${registry}>`.

</TabItem>
<TabItem value="plain-javascript" label="Plain JavaScript">

```js
import { createMapper } from "@crosswalkjs/canvas";
import { registry } from "./crosswalk.js";

createMapper(document.getElementById("mapper"), { document: startingMap, registry });
```

</TabItem>
</Tabs>

### From your server

When a server runs the maps, the browser asks it for its operators instead. Add a loader to the same module:

```ts title="crosswalk.ts"
import { registryFromCatalog, type OperatorRegistry } from "@crosswalkjs/core";

export async function loadRegistry(): Promise<OperatorRegistry> {
  const response = await fetch("/crosswalk/operators");
  if (!response.ok) throw new Error(`Couldn't load the operators (${response.status})`);
  return registryFromCatalog(await response.json());
}
```

The editor reads its registry once, so wait for the catalogue before showing it:

<Tabs groupId="framework" queryString lazy>
<TabItem value="react" label="React">

```tsx
import { useEffect, useState } from "react";
import type { MapDocument, OperatorRegistry } from "@crosswalkjs/core";
import { MapEditor } from "./MapEditor";
import { loadRegistry } from "./crosswalk";

export function MapPage({ map }: { map: MapDocument }) {
  const [registry, setRegistry] = useState<OperatorRegistry>();

  useEffect(() => {
    let current = true;
    void loadRegistry().then((loaded) => current && setRegistry(loaded));
    return () => {
      current = false;
    };
  }, []);

  return registry ? <MapEditor map={map} registry={registry} /> : <p>Loading operators…</p>;
}
```

In Next.js this is a client component, with `"use client";` at the top.

</TabItem>
<TabItem value="vue" label="Vue">

```vue
<script setup lang="ts">
import { onMounted, shallowRef } from "vue";
import type { MapDocument, OperatorRegistry } from "@crosswalkjs/core";
import MapEditor from "./MapEditor.vue";
import { loadRegistry } from "./crosswalk";

defineProps<{ map: MapDocument }>();

// shallowRef, so Vue doesn't wrap the registry in a proxy.
const registry = shallowRef<OperatorRegistry>();
onMounted(async () => {
  registry.value = await loadRegistry();
});
</script>

<template>
  <MapEditor v-if="registry" :map="map" :registry="registry" />
  <p v-else>Loading operators…</p>
</template>
```

`onMounted` only runs in the browser, so this works as it is in Nuxt.

</TabItem>
<TabItem value="svelte" label="Svelte">

```svelte
<script lang="ts">
  import type { MapDocument } from "@crosswalkjs/core";
  import MapEditor from "./MapEditor.svelte";
  import { loadRegistry } from "./crosswalk";

  let { map }: { map: MapDocument } = $props();
</script>

{#await loadRegistry()}
  <p>Loading operators…</p>
{:then registry}
  <MapEditor {map} {registry} />
{/await}
```

In SvelteKit, load the catalogue in the page's `load` function with the `fetch` it's given, and turn it into a registry in the component with `registryFromCatalog(data.catalog)`. The catalogue is plain JSON, so it travels from the server to the page; a registry wouldn't.

</TabItem>
<TabItem value="angular" label="Angular">

```ts
import { Component, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";
import { registryFromCatalog, type OperatorCatalog } from "@crosswalkjs/core";
import { MapEditorComponent } from "./map-editor.component";

@Component({
  selector: "app-map-page",
  imports: [MapEditorComponent],
  template: `
    @if (registry(); as registry) {
      <app-map-editor [map]="startingMap" [registry]="registry" />
    } @else {
      <p>Loading operators…</p>
    }
  `,
})
export class MapPageComponent {
  readonly startingMap = startingMap;
  readonly registry = toSignal(
    inject(HttpClient)
      .get<OperatorCatalog>("/crosswalk/operators")
      .pipe(map((catalog) => registryFromCatalog(catalog))),
  );
}
```

This needs `provideHttpClient()` in the app's providers.

</TabItem>
<TabItem value="solid" label="Solid">

```tsx
import { createResource, Show } from "solid-js";
import type { MapDocument } from "@crosswalkjs/core";
import { MapEditor } from "./MapEditor";
import { loadRegistry } from "./crosswalk";

export function MapPage(props: { map: MapDocument }) {
  const [registry] = createResource(loadRegistry);

  return (
    <Show when={registry()} fallback={<p>Loading operators…</p>}>
      {(loaded) => <MapEditor map={props.map} registry={loaded()} />}
    </Show>
  );
}
```

</TabItem>
<TabItem value="astro" label="Astro">

```astro
<div id="mapper" data-map={JSON.stringify(map)} style="height: 600px"></div>

<script>
  import { createMapper } from "@crosswalkjs/canvas";
  import { loadRegistry } from "../crosswalk";

  const element = document.getElementById("mapper")!;
  loadRegistry().then((registry) => {
    createMapper(element, { document: JSON.parse(element.dataset.map!), registry });
  });
</script>
```

</TabItem>
<TabItem value="web-components" label="Web Components">

```ts
import { loadRegistry } from "./crosswalk";

const editor = document.createElement("crosswalk-editor") as CrosswalkEditor;
editor.map = startingMap;
loadRegistry().then((registry) => {
  editor.registry = registry;
  document.body.append(editor);
});
```

The element reads `registry` when it's added to the page, so set it first.

</TabItem>
<TabItem value="plain-javascript" label="Plain JavaScript">

```js
import { createMapper } from "@crosswalkjs/canvas";
import { loadRegistry } from "./crosswalk.js";

loadRegistry().then((registry) => {
  createMapper(document.getElementById("mapper"), { document: startingMap, registry });
});
```

A `.then`, rather than `await` at the top of the module: bundlers such as Vite don't allow top-level `await` by default.

</TabItem>
</Tabs>

Here it is running, with a stand-in for your server answering `/crosswalk/operators` and `/crosswalk/preview`. Customer tier only exists on that server, so it shows in the toolbox and its value in the preview, but it never runs in the browser:

<Sandbox example="operators-from-server" height={380} />

To preview with the server's operators, give the `createMapper` call in your component a `preview` with `run: previewOverHttp("/crosswalk/preview")`. [Connecting to a server](../editor/server.md) covers both endpoints.
