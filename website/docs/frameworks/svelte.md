---
title: Svelte
description: Use the Crosswalk editor in Svelte 5 and SvelteKit.
---

# Svelte

These examples use Svelte 5 and its runes.

## Install

```bash
npm install @crosswalkjs/canvas @crosswalkjs/core
```

## The component

```svelte title="MapEditor.svelte"
<script lang="ts">
  import { untrack } from "svelte";
  import { createMapper, type Mapper, type ThemeDefinition } from "@crosswalkjs/canvas";
  import type { MapDocument, OperatorRegistry } from "@crosswalkjs/core";

  interface Props {
    map: MapDocument;
    /** A theme id, or your own theme. */
    theme?: string | ThemeDefinition;
    /** Your operators. Read once, when the editor is created. */
    registry?: OperatorRegistry;
    height?: string;
    onchange?: (map: MapDocument) => void;
  }

  let { map, theme = "ink", registry, height = "600px", onchange }: Props = $props();

  let host: HTMLDivElement;
  let editor: Mapper | undefined;

  // Create the editor once. `untrack` stops later changes to the props from
  // re-creating it.
  $effect(() => {
    const created = untrack(() =>
      createMapper(host, { document: map, theme, registry, onChange: (next) => onchange?.(next) }),
    );
    editor = created;
    return () => created.destroy();
  });

  // Switch theme when the prop changes.
  $effect(() => {
    editor?.setTheme(theme);
  });

  export function setDocument(next: MapDocument) {
    editor?.setDocument(next);
  }
</script>

<div bind:this={host} style:height></div>
```

## Using it

```svelte title="App.svelte"
<script lang="ts">
  import { createTransform, type MapDocument } from "@crosswalkjs/core";
  import MapEditor from "./MapEditor.svelte";
  import startingMap from "./order.map.json";
  import sampleOrder from "./sample-order.json";

  let map = $state(startingMap as MapDocument);
  let output = $derived.by(() => {
    try {
      return createTransform(map)(sampleOrder);
    } catch (error) {
      return (error as Error).message;
    }
  });
</script>

<MapEditor map={startingMap as MapDocument} onchange={(next) => (map = next)} />
<pre>{JSON.stringify(output, null, 2)}</pre>
```

To load a different map, call the component's `setDocument` through `bind:this`, or wrap it in a `{#key}` block.

## SvelteKit

The component needs no changes for SvelteKit ([why](./overview.md#server-rendering)). Load the map in a `load` function and pass it in as a prop. A map is plain JSON, so it crosses from server to browser as it is.

## Svelte 4

On Svelte 4, replace the runes with `export let` props, `onMount` (returning the cleanup) and `$: editor?.setTheme(theme)`. The rest is the same.
