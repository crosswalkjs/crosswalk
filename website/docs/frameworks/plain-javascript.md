---
title: Plain JavaScript
description: Use the Crosswalk editor with no framework, with or without a build step.
---

import Sandbox from '@site/src/components/Sandbox';

# Plain JavaScript

## With a bundler

```bash
npm install @crosswalkjs/canvas @crosswalkjs/core
```

Here's a whole page, running. Edit any file and the preview follows; **Reset** puts it back:

<Sandbox example="plain-javascript" height={560} />

## Without a build step

Browsers can load both packages as ES modules from a CDN, such as [esm.sh](https://esm.sh), with an import map:

```html title="index.html"
<script type="importmap">
  {
    "imports": {
      "@crosswalkjs/core": "https://esm.sh/@crosswalkjs/core@0.1",
      "@crosswalkjs/canvas": "https://esm.sh/@crosswalkjs/canvas@0.1?external=@crosswalkjs/core"
    }
  }
</script>

<div id="mapper" style="height: 600px"></div>

<script type="module">
  import { createMapper } from "@crosswalkjs/canvas";

  const map = await fetch("./order.map.json").then((response) => response.json());

  createMapper(document.getElementById("mapper"), {
    document: map,
    onChange: (next) => localStorage.setItem("order-map", JSON.stringify(next)),
  });
</script>
```

`?external=@crosswalkjs/core` makes the canvas use the same copy of the core package as your own imports, rather than its own.

Pin a version you've tested, as above, rather than taking whatever is latest.
