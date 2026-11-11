---
title: Embedding the editor
description: createMapper's options and the methods on the editor it returns.
---

import Sandbox from '@site/src/components/Sandbox';

# Embedding the editor

```ts
import { createMapper } from "@crosswalkjs/canvas";

const mapper = createMapper(element, options);
```

`createMapper` builds the editor inside `element` and returns an object for controlling it. The editor fills the element, so give it a height.

## Options

| Option | What it does |
|---|---|
| `document` | The map to start with. Required. To start empty, give it your schemas with no nodes or links. |
| `registry` | The operators to offer. Defaults to every built-in. See [Your own operators](../operators/custom-operators.md). |
| `theme` | A theme id, or your own theme definition. Defaults to `"ink"`. See [Themes](../themes/built-in.mdx). |
| `onChange(document)` | Called after every edit made in the editor, with a copy of the new map. |
| `toolboxCollapsed` | Start with the toolbox collapsed to a narrow rail (`true`) or open (`false`). Leave it out and it collapses by itself while the editor is narrower than 720px, until someone opens or closes it. |
| `onToolboxToggle(collapsed, automatic)` | Called when the toolbox is collapsed or expanded, so you can remember the choice. `automatic` is true when it folded or opened by itself as the editor's width changed, which usually isn't worth remembering. |
| `readOnly` | Show the map without letting anyone change it. |
| `mappedOnly` | Hide fields nothing maps to or from. |
| `autoLayout` | Place operators between the fields they connect, ignoring saved positions. |
| `fitContent` | Size the editor to its content rather than its container. |
| `phoneView` | `false` keeps the canvas on a phone-sized screen, rather than the list of fields. See [On a phone](#on-a-phone). |
| `zoom` | How far the grid starts zoomed, from `0.4` to `2`. Full size, `1`, by default. The **⤢** button by the zoom fits every operator in view. |
| `hidePages` | Hide the page tabs and show the whole map on one grid. The pages are kept in the document. |
| `hideSearch` | Hide the magnifier in each tree's heading that finds a field. |
| `editSchemas` | Let people replace the source or target schema from each tree's heading: from a sample, a JSON Schema, or an OpenAPI document. Off by default. See [Schemas](../maps/schemas.mdx#in-the-editor). |
| `onPerformance` | Called with `{ kind, ms }`: how long a `render` took after an edit, including the browser laying it out, and each `redraw` of the lines. See [Big maps](./big-maps.mdx). |
| `preview` | `{ input, run?, delay? }`: show each target field's value for a sample input. See [Connecting to a server](./server.md#live-preview). |
| `labels` | The editor's wording, in your words or language. See [In your own words](#in-your-own-words). |
| `onSelectionChange(selection)` | Called when what's selected changes. See [Following along](#following-along). |
| `onPageChange(page, submap)` | Called when the page or sub-map shown changes. |
| `onIssuesChange(issues)` | Called with every issue when the map is first shown, and whenever they change. |

For a read-only summary, [`createMapView`](./read-only-view.mdx) turns on the last four together.

Try some, and watch the console as you edit:

<Sandbox example="embedding-options" height={400} />

## The editor object

| Method | What it does |
|---|---|
| `getDocument()` | A copy of the current map. |
| `setDocument(map)` | Replaces the map, such as after loading another one. It doesn't call `onChange`, and it can be undone. |
| `getIssues()` | Every current issue, as `analyseMap` reports them. |
| `setTheme(theme)` | Switches theme straight away: an id or a definition. |
| `setPreviewInput(input)` | Changes the preview's sample input, or turns the preview off with `undefined`. |
| `getSelection()` | What's selected, if anything, in the same shape as `onSelectionChange` gives it. |
| `undo()`, `redo()` | The same as Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z. |
| `destroy()` | Removes the editor from the page. Call it when the element goes away. |

Each button calls one:

<Sandbox example="editor-methods" height={460} />

## On a phone

Three columns side by side don't fit a phone, so below 560px wide the editor shows the map as a list instead. Each target field says where its value comes from and, with a `preview` input, what it is for the sample. Tapping a field opens a sheet with how it's made, step by step, each with its value, and there you can link a source field, add an operator, type a value or stop mapping it. A step inside a total shows a value for each item, so you can see what a filter keeps.

It's the same map: changes go through the same `onChange` and undo as the canvas, and open unchanged on a bigger screen. Sub-maps, pages, notes and what a repeating record repeats over are set on a bigger screen.

Pass `phoneView: false` to keep the canvas at every size.

## In your own words

Every piece of the editor's wording can be changed with `labels`, to translate it or to use your product's own terms, such as "property" for "field". Give only what you want to change; the rest stays in English. `englishLabels`, exported from `@crosswalkjs/canvas`, has every one, and its type, `Labels`, documents them.

Wording with something in it is a function, so a translation can put the words in its own order and get its plurals right: ``inputLabel: (index) => `Entrée ${index + 1}` ``. Two cover what comes from elsewhere:

- `operator(definition)` gives an operator's name, description and input labels, so the built-in operators can be translated too.
- `issue(issue)` words an issue. Each issue has a `code`, such as `input-count` or `required-unmapped`, listed in [How a map runs](../maps/how-maps-run.md), so you can word them by code.

The read-only view takes `labels` as well.

<Sandbox example="labels" height={420} />

## Following along

Three events let your page keep up with the editor, such as showing your own panel for the selected operator, or a list of problems beside it. Each is called only when something changes.

| Event | Called with |
|---|---|
| `onSelectionChange(selection)` | `{ kind: "operator", id }`, `{ kind: "operators", ids }`, `{ kind: "link", index }` (its place in the map's `links`) or `{ kind: "loop", target }`; `undefined` when nothing is. |
| `onPageChange(page, submap)` | The id of the page shown, `undefined` in a map without pages, and the sub-map shown, if one is. |
| `onIssuesChange(issues)` | Every issue, as `getIssues()` gives them: once when the map is first shown, and again whenever they change. |

<Sandbox example="editor-events" height={460} />

## Saving and loading

The map is the only state worth saving; the editor holds nothing else.

<Sandbox example="saving" height={400} />


`onChange` fires on every edit, including each drag that moves an operator. Debounce it if saving is expensive.

## Showing the output as people edit

The editor doesn't run the map itself. To show live output, run it in `onChange`. A map with errors can't run, so show why instead:

<Sandbox example="live-output" height={520} />


## Styling

The editor adds two style elements to the page's `<head>` the first time it's used: one for its layout and one per theme in use. Every class starts with `cw-`, and all of its colours, fonts and corner radii are `--cw-*` custom properties set by the theme. Prefer a [theme of your own](../themes/custom-themes.md) to overriding classes: themes are the supported way to change the look, while class names may change between versions.
