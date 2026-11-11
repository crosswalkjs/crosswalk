---
title: Overview
description: How the Crosswalk editor fits into any framework.
---

# Frameworks

The editor is plain DOM with no framework of its own, so it works the same way everywhere:

1. **Create it once the element is on the page:** `createMapper(element, { document: map, onChange })`.
2. **Hear about edits through `onChange`**, which gets a copy of the new map after every change.
3. **Destroy it when the element goes:** `mapper.destroy()`.

Each framework has its own way of doing those three things. The pages here each give a ready-made editor component, how to use it, and what to watch for in that framework's server-rendering setup.

| Framework | Page | Also covers |
|---|---|---|
| React | [React](./react.md) | Next.js, Preact |
| Vue | [Vue](./vue.md) | Nuxt |
| Svelte 5 | [Svelte](./svelte.md) | SvelteKit |
| Angular | [Angular](./angular.md) | Angular SSR |
| Solid | [Solid](./solid.md) | SolidStart |
| Astro | [Astro](./astro.md) | |
| Any, as a custom element | [Web Components](./web-components.md) | Lit, and frameworks not listed here |
| None | [Plain JavaScript](./plain-javascript.md) | A CDN with no build step |

## Give it a height

The editor fills its container, so the container needs a height. Without one it collapses to nothing.

## The map belongs to the editor

The map you pass in is where the editor starts. After that the editor keeps its own copy, and tells you about changes through `onChange`. Saving what comes out of `onChange` is fine, but don't pass every change back in as a new map, because the editor already has it.

To load a different map, such as when someone opens another one, call `setDocument(next)` on the editor. Each page shows how to reach it from your component.

## Server rendering

The editor needs the browser. Every component here creates it in the hook that runs once the element is on the page, and those hooks never run on the server. So server-rendered apps need no extra setup: the server sends an empty element, and the editor appears when the page loads. The pages note anything specific to each framework's server rendering.

## Running maps

Running a map doesn't need the editor or a framework. `createTransform` from `@crosswalkjs/core` works the same in a component, a server route or a background job. See [How a map runs](../maps/how-maps-run.md).
