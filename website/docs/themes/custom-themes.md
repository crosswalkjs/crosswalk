---
title: Your own themes
description: Define a theme, starting from any other.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import Sandbox from '@site/src/components/Sandbox';
import ThemeBuilder from '@site/src/components/ThemeBuilder';

# Your own themes

A theme starts from the one it `extends`, Studio by default, and changes only what it sets. Try it here: change anything, and the editor and the code under it follow. A dot marks what you've changed, and **↺** puts it back.

<ThemeBuilder />

The same in code. A brand colour is one line:

<Sandbox example="custom-theme" height={400} />


Or start from any built-in and go further:

<Sandbox example="theme-aurora" height={400} />


Pass a definition straight to the `theme` option or `setTheme()`. To use it by id, or have other themes extend it, register it first:

<Sandbox example="theme-register" height={440} />


## In your framework

Define the theme once, in a module of its own:

```ts title="crosswalk.ts"
import { defineTheme } from "@crosswalkjs/canvas";

export const brand = defineTheme({ id: "brand", label: "Brand", extends: "nord", colors: { accent: "#e5007d" } });
```

Each [framework's](../frameworks/overview.md) editor component takes a theme id or a definition as `theme`, and switches when it changes:

<Tabs groupId="framework" queryString lazy>
<TabItem value="react" label="React">

```tsx
import { MapEditor } from "./MapEditor";
import { brand } from "./crosswalk";

<MapEditor map={map} theme={brand} />
```

Define the theme outside the component, as here, so it isn't a new object on every render.

</TabItem>
<TabItem value="vue" label="Vue">

```vue
<script setup lang="ts">
import MapEditor from "./MapEditor.vue";
import { brand } from "./crosswalk";
</script>

<template>
  <MapEditor :map="map" :theme="brand" />
</template>
```

</TabItem>
<TabItem value="svelte" label="Svelte">

```svelte
<script lang="ts">
  import MapEditor from "./MapEditor.svelte";
  import { brand } from "./crosswalk";
</script>

<MapEditor {map} theme={brand} />
```

</TabItem>
<TabItem value="angular" label="Angular">

```ts
import { brand } from "./crosswalk";

@Component({
  imports: [MapEditorComponent],
  template: `<app-map-editor [map]="startingMap" [theme]="brand" />`,
})
export class MapPageComponent {
  readonly brand = brand;
  // ...
}
```

</TabItem>
<TabItem value="solid" label="Solid">

```tsx
import { MapEditor } from "./MapEditor";
import { brand } from "./crosswalk";

<MapEditor map={map} theme={brand} />
```

</TabItem>
<TabItem value="astro" label="Astro">

```astro
<div id="mapper" data-map={JSON.stringify(map)} style="height: 600px"></div>

<script>
  import { createMapper } from "@crosswalkjs/canvas";
  import { brand } from "../crosswalk";

  const element = document.getElementById("mapper")!;
  createMapper(element, { document: JSON.parse(element.dataset.map!), theme: brand });
</script>
```

A theme is plain data, so a framework component with `client:only` can take it from the page's frontmatter as a prop.

</TabItem>
<TabItem value="web-components" label="Web Components">

```ts
import { registerTheme } from "@crosswalkjs/canvas";
import { brand } from "./crosswalk";

// The element's theme is an attribute, so register the theme and use its id.
registerTheme(brand);
editor.setAttribute("theme", "brand");
```

</TabItem>
<TabItem value="plain-javascript" label="Plain JavaScript">

```js
import { createMapper } from "@crosswalkjs/canvas";
import { brand } from "./crosswalk.js";

createMapper(document.getElementById("mapper"), { document: startingMap, theme: brand });
```

</TabItem>
</Tabs>

## Themes from your server

A theme is plain JSON, so your server can store one, such as a theme per customer, and send it down. Pass what it sends as the `theme`, as above.

Every value in a theme is checked before it becomes CSS, wherever the theme came from. Something that could end its rule, start a comment or load a file, such as `;`, `{`, `}`, `/*` or `url(`, is refused with an error naming the setting. So a theme a customer has edited can't restyle the rest of your page or fetch anything. Catch the error where you use the theme, and fall back to a built-in one:

<Sandbox example="theme-from-server" height={400} />


If your server runs Node, call `defineTheme` when the theme is saved as well, so a bad one is turned away then.

## Settings

Everything except `id` and `label` is optional.

| Setting | What it changes |
|---|---|
| `id`, `label`, `description`, `group` | How the theme is named. `id` starts with a letter and uses only letters, digits, `-` and `_`. `group` sorts themes in a picker. |
| `extends` | The theme to start from: an id or a definition. |
| `scheme` | `"light"` or `"dark"` fixes the scheme. `"auto"` follows the system and applies `darkColors` over `colors` in dark mode. |
| `colors`, `darkColors` | The editor's colours (below). |
| `categories` | Operator tile colours, by category id. Works for your own categories too. `"*"` colours every category, including ones added with a colour of their own; a category named as well keeps its own. A colour can be a variable, such as `var(--cw-text)`, so tiles can follow light and dark mode, as `ink` does. |
| `glyph`, `glyphs` | The colour of the symbol on tiles, and per-category overrides where a tile is too light or too dark for it. |
| `tileBorder` | An outline for every tile, a little heavier than the usual one. Left out, each tile is outlined a shade darker than itself. With tiles the panel's colour and the glyph and outline the text colour, tiles are outlined rather than filled. |
| `tileShadow` | A shadow for every tile, as a CSS `box-shadow`, such as `2px 2px 0 #15171c` for tiles stamped in ink, as `ink` has them. Hover and selection rings add to it. |
| `fonts` | `ui` is a CSS `font` shorthand for the whole editor, such as `13px/1.4 Inter, sans-serif`. `glyph` and `code` are font families for tile symbols and code-like text. |
| `shape` | Corner radii: `radius` for panels, `node` for operators on the grid, `chip` for the toolbox. `50%` makes them round. |
| `links`, `linkWidth` | `"curved"`, `"straight"` or `"elbow"` (right angles), and the line width. |
| `grid`, `gridSize` | `"dots"`, `"lines"`, `"drafting"` (major and minor lines) or `"none"`, and the spacing in pixels. |
| `density` | `"compact"`, `"regular"` or `"roomy"`: the height of tree rows and the size of operators and toolbox chips. Text size is part of `fonts.ui`. |

### Colours

| Colour | Used for |
|---|---|
| `background` | The grid, and inputs. |
| `panel` | The toolbox, trees and inspector. |
| `text`, `muted`, `faint` | Main text, secondary text, and labels and hints. |
| `border` | Dividers and outlines. |
| `grid` | The grid's dots or lines. |
| `hover` | Rows and buttons under the pointer. |
| `link` | Lines between fields and operators. |
| `accent`, `accentSoft` | Selection, highlighted lines and focus rings, and the soft fill behind them. |
| `error` | Error badges and messages. |
| `shadow` | A CSS `box-shadow` for tiles. |
| `note` | The tint of notes, mixed with `panel`. |

Most of them at once:

<Sandbox example="theme-settings" height={400} />

## Fixing light or dark

Studio follows the operating system. If your app has its own light and dark switch, make a fixed version of each and switch between them:

<Sandbox example="theme-light-dark" height={440} />


That's what these docs do, so the editors here follow the site's own toggle.

## How themes reach the page

A theme becomes CSS custom properties (`--cw-*`) under `.cw-root[data-cw-theme="<id>"]`, added to the page the first time the theme is used. `resolveTheme()` returns a theme with everything filled in from what it extends, and `themeStyles()` returns its CSS, if you'd rather ship it in a stylesheet yourself.
