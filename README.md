# Crosswalk

A visual mapper for JSON: a source tree and a target tree, with links and operators between them. Drag a field across to copy it, or through operators to transform it on the way.

**[Documentation](https://crosswalkjs.github.io/crosswalk/)** · **[Playground](https://crosswalkjs.github.io/crosswalk/playground)** · [`@crosswalkjs/core`](https://www.npmjs.com/package/@crosswalkjs/core) · [`@crosswalkjs/canvas`](https://www.npmjs.com/package/@crosswalkjs/canvas)

```bash
npm install @crosswalkjs/canvas @crosswalkjs/core
```

## Packages

| Package | Status |
|---|---|
| `@crosswalkjs/core` | The map document, schemas, operators, validation and evaluation. No UI. |
| `@crosswalkjs/canvas` | The editor: an operator toolbox, source and target trees, a grid of operators, links and an inspector. Plain DOM, no framework. |
| `Crosswalk.Core` (NuGet) | Runs maps in .NET 8 and later. In [`dotnet/`](dotnet/). |

## The map document

A map is plain JSON, so it can live in git and be diffed. Fields are addressed by path: keys are joined with `.` and a repeating field is written with `[]`, so `PhoneCalls[].Cost` is the `Cost` of each phone call.

```json
{
  "version": 1,
  "source": { "type": "object", "properties": { "...": {} } },
  "target": { "type": "object", "properties": { "...": {} } },
  "nodes": [
    { "id": "fullName", "operator": "text.concat", "constants": { "1": " " } }
  ],
  "links": [
    { "from": { "source": "FirstName" }, "to": { "node": "fullName", "input": 0 } },
    { "from": { "source": "LastName" }, "to": { "node": "fullName", "input": 2 } },
    { "from": { "node": "fullName" }, "to": { "target": "FullName" } }
  ],
  "loops": [{ "source": "PhoneCalls[]", "target": "Calls[]" }]
}
```

[`person.map.json`](packages/core/test/fixtures/person.map.json) is a fuller example: a person and their phone calls mapped to a profile with a full name, an age and call totals.

## How a map runs

- **Unmapped and missing fields are left out.** A source field that isn't there produces nothing, not `null`, and most operators pass that through.
- **Only if gates a value.** When its condition is false the target field is left out. An object or array item with nothing mapped into it is left out too, so gating every field of an item filters it.
- **Repetition is explicit.** A loop says which source array a target array repeats over. An aggregate operator, such as `aggregate.sum`, names the source array it aggregates over in its `scope`. Reading a repeating field into a single value without either one is a validation error.

`createTransform` checks the map once and throws a `MapValidationError` listing every error. `analyseMap` returns the same errors, plus warnings, without throwing, which is what an editor shows.

## Operators

There are 41 built-in operators in six categories: Text, Math, Logic, Convert, Flow and Aggregate. `createRegistry` decides which ones a map and the editor's toolbox can use.

```ts
import { createRegistry, defineCategory, defineOperator, toText } from "@crosswalkjs/core";

const acme = defineCategory({ id: "acme", label: "Acme", color: "#ff3366" });

const shout = defineOperator({
  kind: "value",
  id: "acme.shout",
  label: "Shout",
  glyph: "!!",
  category: "acme",
  inputs: { min: 1, max: 1 },
  run: ([text]) => `${toText(text ?? null).toUpperCase()}!`,
});

const registry = createRegistry({
  // All built-ins (the default), none (false), or a filter:
  builtins: (operator) => operator.category !== "math",
  categories: [acme],
  operators: [shout],
});

const run = createTransform(map, { registry });
```

- **Your own operators** are `kind: "value"`, which works out one value from its inputs, or `kind: "aggregate"`, which reduces one input across a repeating record.
- **Categories** group operators in the toolbox, in the order they're registered. A category's `color` is used unless the theme sets one for it. Registering a category with a built-in's id relabels or recolours it.
- **`registry.unregister(id)`** takes an operator out after the fact. A map that still uses it reports it as unknown rather than failing to load.

## The editor

```ts
import { createMapper } from "@crosswalkjs/canvas";

const mapper = createMapper(document.getElementById("mapper")!, {
  document: map,
  registry, // optional, defaults to every built-in operator
  theme: "nord", // optional, defaults to "studio"
  onChange: (map) => save(map),
  toolboxCollapsed: false, // optional; onToolboxToggle reports changes so you can remember them
});
```

- Drag an operator from the toolbox on the left onto the grid, or click it to drop it in the middle. The toolbox can be searched, and collapsed to a narrow rail.
- Drag a source field onto an operator to fill its next input, or onto a target field to copy it straight across.
- Drag an operator's dot onto a target field, or onto another operator.
- Drag a repeating source record onto a repeating target record to make a loop, or onto an aggregate operator to set what it aggregates over.
- Click an operator to edit its constants and reorder its inputs. Click a line to select it. Delete removes the selection, and Cmd/Ctrl+Z undoes.

For a summary page or a review form, `createMapView(element, { document: map })` draws the same map read-only, in the same theme: only the mapped fields, with the operators laid out between them, sized to fit.

The editor checks the map as you go: operators with errors get a red badge and target fields with errors are underlined. `mapper.getIssues()` returns the full list.

## Themes

Pick a theme with the `theme` option or `mapper.setTheme()`. Four are designed for the editor:

| Theme | Look |
|---|---|
| `studio` (default) | Clean and neutral, with curved links. Follows light and dark mode. |
| `classic` | A traditional mapping tool: square tiles, straight lines and a ruled grid. Follows light and dark mode. |
| `blueprint` | Always dark: a drafting grid, right-angled links and monospace labels. |
| `paper` | Always light: warm and quiet, with round tiles, no grid and a serif face. |

Nine follow well-known editor colour schemes, with each scheme's own colours on the operator tiles: `github-light`, `solarized-light`, `solarized-dark`, `one-dark`, `dracula`, `nord`, `gruvbox-dark`, `monokai` and `tokyo-night`.

### Your own themes

A theme starts from the one it `extends` (Studio by default) and changes only what it sets:

```ts
import { defineTheme, registerTheme } from "@crosswalkjs/canvas";

const aurora = defineTheme({
  id: "aurora",
  label: "Aurora",
  extends: "nord",
  colors: { accent: "#f5a3c7", accentSoft: "rgba(245, 163, 199, .18)" },
  categories: { acme: "#a3be8c" }, // tile colours, by category id
  links: "elbow", // "curved", "straight" or "elbow"
  shape: { node: "50%", chip: "50%" }, // round tiles
});

mapper.setTheme(aurora); // use it directly…
registerTheme(aurora); // …or register it, so it can be picked by id and extended
```

| Setting | What it changes |
|---|---|
| `scheme` | `"light"` or `"dark"` fixes the scheme. `"auto"` follows the system, with `darkColors` applied on top of `colors` in dark mode. |
| `colors`, `darkColors` | `background`, `panel`, `text`, `muted`, `faint`, `border`, `grid`, `hover`, `link`, `accent`, `accentSoft`, `error` and `shadow`. |
| `categories`, `glyph`, `glyphs` | Tile colours by category, the glyph colour on tiles, and per-category glyph colours where a tile needs a darker or lighter glyph. |
| `fonts` | `ui` (a CSS `font` shorthand), `glyph` and `code` (font families). |
| `shape` | Corner radii: `radius` for panels, `node` for operators on the grid, `chip` for the toolbox. |
| `links`, `linkWidth`, `grid`, `gridSize` | Link shape and width, and the grid: `"dots"`, `"lines"`, `"drafting"` or `"none"`. |

Each theme becomes CSS custom properties (`--cw-*`) scoped to `.cw-root[data-cw-theme="<id>"]`, so a stylesheet can also adjust a theme without code.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run playground
```

For the .NET runtime, in `dotnet/`: `dotnet test`.

The browser tests in [`e2e/`](e2e/) drive the real editor with the pointer and keyboard: linking, dragging, selecting, pages, sub-maps, copy and paste. They serve a small fixture page from the source on port 5180. The first time, install the browser with `npx playwright install chromium`, then:

```bash
npm run e2e
```

One of them checks the editor stays quick with 1,200 operators. To see how redraws grow from 100 to 2,000 operators, run `PERF_SWEEP=1 npx playwright test e2e/perf.spec.ts`, adding `THROTTLE=4` to slow the CPU down to a typical laptop's.

The playground (http://localhost:5173) has the editor above the map JSON, an input and the live output. Both editors stay in sync. It also shows a custom operator category (People) and a custom theme (Aurora).

The documentation site is in [`website/`](website/README.md).

[`conformance/`](conformance/README.md) defines what a map means as test cases that every runtime must pass. The TypeScript core runs them with `npm test`.

### Releasing

1. Bump `version` in `packages/core/package.json`, `packages/canvas/package.json` (and the canvas's dependency on core) and `dotnet/Directory.Build.props`, then commit.
2. Publish a GitHub release. The Release workflow publishes both packages to npm with provenance, and `Crosswalk.Core` to NuGet.

The repo's `.npmrc` pins the public npm registry, whatever your own npm config says.

## Licence

MIT
