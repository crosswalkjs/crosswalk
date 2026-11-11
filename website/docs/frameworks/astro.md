---
title: Astro
description: Use the Crosswalk editor on an Astro page.
---

# Astro

Astro pages render on the server with no JavaScript unless you ask for it. The editor needs the browser, so there are two ways in.

## Install

```bash
npm install @crosswalkjs/canvas @crosswalkjs/core
```

## With a script

For a page that's mostly static, put the editor's element in the page and create the editor in a `<script>`. Astro bundles the script and runs it in the browser.

```astro title="src/pages/editor.astro"
---
import map from "../maps/order.map.json";
---

<div id="mapper" data-map={JSON.stringify(map)} style="height: 600px"></div>

<script>
  import { createMapper } from "@crosswalkjs/canvas";

  const element = document.getElementById("mapper")!;
  createMapper(element, {
    document: JSON.parse(element.dataset.map!),
    onChange: (next) => localStorage.setItem("order-map", JSON.stringify(next)),
  });
</script>
```

The map goes to the browser in a `data-` attribute. Astro scripts are bundled modules, so they can't read the page's frontmatter variables directly.

## With a framework component

If the site already uses React, Vue, Svelte or Solid through an Astro integration, use that framework's component from these docs and give it a `client:only` directive. The editor can't do anything useful on the server, so there's nothing to gain from rendering it there:

```astro
---
import { MapEditor } from "../components/MapEditor";
import map from "../maps/order.map.json";
---

<MapEditor client:only="react" map={map} />
```

Use the name of your framework's integration in `client:only`: `"react"`, `"vue"`, `"svelte"`, `"solid-js"` or `"preact"`.
