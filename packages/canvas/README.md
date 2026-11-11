# @crosswalkjs/canvas

The visual editor for [Crosswalk](https://crosswalkjs.github.io/crosswalk/) maps: source and target trees, a toolbox of operators, and links you drag between them. Plain DOM with no framework, so it works in React, Vue, Svelte or a plain page.

```bash
npm install @crosswalkjs/canvas @crosswalkjs/core
```

```ts
import { createMapper } from "@crosswalkjs/canvas";

const mapper = createMapper(document.getElementById("mapper")!, {
  document: map,
  theme: "nord",
  onChange: (map) => save(map),
});
```

There are 14 built-in themes, `ink` by default, and you can define your own. Read the [documentation](https://crosswalkjs.github.io/crosswalk/) for the editor, themes and the full API.

MIT licensed.
