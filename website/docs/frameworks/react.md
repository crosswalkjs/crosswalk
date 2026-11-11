---
title: React
description: Use the Crosswalk editor in React, Next.js and Preact.
---

# React

## Install

```bash
npm install @crosswalkjs/canvas @crosswalkjs/core
```

## The component

```tsx title="MapEditor.tsx"
import { useEffect, useRef } from "react";
import { createMapper, type Mapper, type ThemeDefinition } from "@crosswalkjs/canvas";
import type { MapDocument, OperatorRegistry } from "@crosswalkjs/core";

interface MapEditorProps {
  map: MapDocument;
  onChange?: (map: MapDocument) => void;
  /** A theme id, or your own theme. */
  theme?: string | ThemeDefinition;
  /** Your operators. Read once, when the editor is created. */
  registry?: OperatorRegistry;
  height?: number;
}

export function MapEditor({ map, onChange, theme = "ink", registry, height = 600 }: MapEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Mapper | null>(null);
  // The editor calls the latest onChange without being re-created.
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;

  useEffect(() => {
    editor.current = createMapper(host.current!, {
      document: map,
      theme,
      registry,
      onChange: (next) => latestOnChange.current?.(next),
    });
    return () => {
      editor.current?.destroy();
      editor.current = null;
    };
    // The editor owns the map once it's created: `map` is where it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    editor.current?.setTheme(theme);
  }, [theme]);

  return <div ref={host} style={{ height }} />;
}
```

## Using it

```tsx title="App.tsx"
import { useMemo, useState } from "react";
import { createTransform, type MapDocument } from "@crosswalkjs/core";
import { MapEditor } from "./MapEditor";
import startingMap from "./order.map.json";
import sampleOrder from "./sample-order.json";

export function App() {
  const [map, setMap] = useState(startingMap as MapDocument);
  const output = useMemo(() => {
    try {
      return createTransform(map)(sampleOrder);
    } catch (error) {
      return (error as Error).message;
    }
  }, [map]);

  return (
    <>
      <MapEditor map={startingMap as MapDocument} onChange={setMap} />
      <pre>{JSON.stringify(output, null, 2)}</pre>
    </>
  );
}
```

Keeping `map` in state is fine for saving it or showing the output, but the editor is still given `startingMap` ([why](./overview.md#the-map-belongs-to-the-editor)). To load a different map, change the component's `key` so React creates a fresh editor.

:::note React's development mode
In development, `<StrictMode>` mounts components twice to check that they clean up. The component handles that, because it destroys the first editor before creating the second. Without the `destroy()` in the cleanup you'd see two editors.
:::

## Next.js

With the App Router, put `"use client";` as the first line of `MapEditor.tsx`. Nothing else is needed for [server rendering](./overview.md#server-rendering).

```tsx title="app/maps/[id]/page.tsx"
import { MapEditor } from "@/components/MapEditor";
import { loadMap } from "@/lib/maps";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MapEditor map={await loadMap(id)} />;
}
```

The map comes from the server as a prop, which works because a map is plain JSON. To save edits, pass an `onChange` from another client component, or call a server action from one. Functions can't be passed from a server component to a client one.

With the Pages Router no directive is needed.

## Preact

The same component works with Preact through `preact/compat`, the usual way to run React components on Preact. Using Preact's own hooks, change the imports to `preact/hooks`, and the rest stays the same.
