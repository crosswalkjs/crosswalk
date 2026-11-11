---
title: Getting started
description: Install Crosswalk, run a map, and put the editor on a page.
---

# Getting started

## Install

```bash
npm install @crosswalkjs/canvas @crosswalkjs/core
```

If you only need to run maps, on a server say, install `@crosswalkjs/core` on its own. Both packages ship ES modules and CommonJS, with TypeScript types.

## Run a map

A map describes how to build the target from the source. This one copies the first name across, and joins the first and last names into a full name:

```ts
import { createTransform, type MapDocument } from "@crosswalkjs/core";

const map: MapDocument = {
  version: 1,
  source: {
    type: "object",
    properties: { FirstName: { type: "string" }, LastName: { type: "string" } },
  },
  target: {
    type: "object",
    properties: { GivenName: { type: "string" }, FullName: { type: "string" } },
  },
  nodes: [{ id: "fullName", operator: "text.concat", constants: { 1: " " } }],
  links: [
    { from: { source: "FirstName" }, to: { target: "GivenName" } },
    { from: { source: "FirstName" }, to: { node: "fullName", input: 0 } },
    { from: { source: "LastName" }, to: { node: "fullName", input: 2 } },
    { from: { node: "fullName" }, to: { target: "FullName" } },
  ],
};

const run = createTransform(map);

run({ FirstName: "Ana", LastName: "Silva" });
// { GivenName: "Ana", FullName: "Ana Silva" }
```

The `fullName` node is a Concatenate operator. Its inputs are the first name, then a constant space (input 1), then the last name.

`createTransform` checks the map once and throws a `MapValidationError` listing every problem it finds. The function it returns can be called as often as you like.

You'll rarely write a map by hand. Usually the editor writes it.

## Put the editor on a page

This is the plain DOM version. For React, Vue, Svelte, Angular, Solid or Astro, use the component on [your framework's page](./frameworks/overview.md) instead.

```html
<div id="mapper" style="height: 600px"></div>
```

```ts
import { createMapper } from "@crosswalkjs/canvas";

const mapper = createMapper(document.getElementById("mapper")!, {
  document: map,
  onChange(updated) {
    // Called after every edit, with the new map.
    localStorage.setItem("my-map", JSON.stringify(updated));
  },
});
```

The editor fills its container, so the container needs a height. It adds its own styles to the page.

To run what someone has drawn, pass the map from `onChange`, or `mapper.getDocument()`, to `createTransform`.

## Start from your own data

The editor needs a JSON Schema for each side. If you have sample documents rather than schemas, `inferSchema` builds them:

```ts
import { inferSchema, type MapDocument } from "@crosswalkjs/core";

const map: MapDocument = {
  version: 1,
  source: inferSchema(sampleOrder),
  target: inferSchema(sampleInvoice),
  nodes: [],
  links: [],
};
```

A schema built this way only knows the fields in the sample. If some fields only appear in some documents, check the schema and add them.

## Next

- [The map document](./maps/map-document.md) covers paths, links, constants and loops.
- [Using the editor](./editor/using-the-editor.mdx) covers what you can do with the mouse and keyboard.
- [Frameworks](./frameworks/overview.md) has a ready-made editor component for React, Vue, Svelte, Angular, Solid, Astro and Web Components.
