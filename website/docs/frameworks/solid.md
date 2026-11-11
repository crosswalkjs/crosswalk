---
title: Solid
description: Use the Crosswalk editor in Solid and SolidStart.
---

# Solid

## Install

```bash
npm install @crosswalkjs/canvas @crosswalkjs/core
```

## The component

```tsx title="MapEditor.tsx"
import { createEffect, onCleanup, onMount } from "solid-js";
import { createMapper, type Mapper, type ThemeDefinition } from "@crosswalkjs/canvas";
import type { MapDocument, OperatorRegistry } from "@crosswalkjs/core";

interface MapEditorProps {
  map: MapDocument;
  /** A theme id, or your own theme. */
  theme?: string | ThemeDefinition;
  /** Your operators. Read once, when the editor is created. */
  registry?: OperatorRegistry;
  height?: string;
  onChange?: (map: MapDocument) => void;
  ref?: (editor: Mapper) => void;
}

export function MapEditor(props: MapEditorProps) {
  let host!: HTMLDivElement;
  let editor: Mapper | undefined;

  onMount(() => {
    // onMount doesn't track, so this runs once.
    editor = createMapper(host, {
      document: props.map,
      theme: props.theme ?? "ink",
      registry: props.registry,
      onChange: (map) => props.onChange?.(map),
    });
    props.ref?.(editor);
  });

  createEffect(() => {
    editor?.setTheme(props.theme ?? "ink");
  });

  onCleanup(() => editor?.destroy());

  return <div ref={host} style={{ height: props.height ?? "600px" }} />;
}
```

Read props as `props.theme` rather than destructuring them, as usual in Solid, so the theme effect sees changes.

## Using it

```tsx title="App.tsx"
import { createMemo, createSignal } from "solid-js";
import { createTransform, type MapDocument } from "@crosswalkjs/core";
import { MapEditor } from "./MapEditor";
import startingMap from "./order.map.json";
import sampleOrder from "./sample-order.json";

export function App() {
  const [map, setMap] = createSignal(startingMap as MapDocument);
  const output = createMemo(() => {
    try {
      return createTransform(map())(sampleOrder);
    } catch (error) {
      return (error as Error).message;
    }
  });

  return (
    <>
      <MapEditor map={startingMap as MapDocument} onChange={setMap} />
      <pre>{JSON.stringify(output(), null, 2)}</pre>
    </>
  );
}
```

To load a different map later, keep the editor from the `ref` prop and call `setDocument` on it.

## SolidStart

The component needs no changes for SolidStart ([why](./overview.md#server-rendering)). To leave it out of the server render altogether, wrap it in `clientOnly`:

```tsx
import { clientOnly } from "@solidjs/start";

const MapEditor = clientOnly(() => import("./MapEditor").then((m) => ({ default: m.MapEditor })));
```
