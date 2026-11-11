# @crosswalkjs/core

The engine behind [Crosswalk](https://crosswalkjs.github.io/crosswalk/), a visual JSON mapper: the map document, schemas, operators, validation and evaluation. No UI, no dependencies.

```bash
npm install @crosswalkjs/core
```

```ts
import { createTransform } from "@crosswalkjs/core";

const run = createTransform(map); // checks the map once
const output = run(input);
```

A map is plain JSON: a source schema, a target schema, and operators and links between them. Build one by hand, or visually with [`@crosswalkjs/canvas`](https://www.npmjs.com/package/@crosswalkjs/canvas).

Read the [documentation](https://crosswalkjs.github.io/crosswalk/) for the map format, the 41 built-in operators and how to add your own.

MIT licensed.
