---
title: API reference
description: Everything the two packages export.
---

import ApiExplorer from '@site/src/components/ApiExplorer';

# API reference

Everything the two packages export. To see the editor's hooks and methods at work first, try [Hooking into the editor](#hooking-into-the-editor).

## @crosswalkjs/core

### Running maps

| Export | What it is |
|---|---|
| `createTransform(map, { registry? })` | Checks a map and returns a function that runs it: `(input) => output`. Throws `MapValidationError` if the map has errors. |
| `createAsyncTransform(map, { registry?, concurrency? })` | The same, for maps that use async operators: `(input, { signal? }) => Promise<output>`. See [Operators that wait](./maps/how-maps-run.md#operators-that-wait). |
| `transform(map, input, { registry? })` | Checks and runs in one call. |
| `analyseMap(map, registry)` | Checks a map without running it. Returns `{ issues, plan }`; see [Validation](./maps/how-maps-run.md#validation). |
| `MapValidationError` | Has `issues`, the errors found. |
| `MapRuntimeError` | An operator failed on the data. Has `node`, the node's id. |
| `limitsForUserMaps`, `MapLimitError` | Limits for maps users draw, and the error when one is reached. See [Limits](./maps/how-maps-run.md#limits). |

### Operators

| Export | What it is |
|---|---|
| `createRegistry({ builtins?, operators?, categories? })` | A registry of operators. See [Your own operators](./operators/custom-operators.md). |
| `OperatorRegistry` | `register`, `registerCategory`, `unregister`, `get`, `has`, `list`, `getCategory`, `categories`. |
| `defineOperator(definition)` | Type-checks an operator definition. |
| `defineCategory(definition)` | Checks a category definition. |
| `builtinOperators`, `builtinCategories` | The built-ins, as definitions. |
| `OperatorError` | Throw it from an operator for input that doesn't make sense. |
| `toText`, `toNumber`, `toBoolean`, `isNumeric`, `compare` | Read operator inputs the way the built-ins do. |
| `registry.toCatalog()`, `toCatalog(registry)` | The operators as JSON for an editor, with no behaviour. |
| `registryFromCatalog(catalog, { local? })` | A registry from a server's catalogue. See [Connecting to a server](./editor/server.md). |
| `handlePreview({ map, input }, { registry?, signal?, limits? })` | Serves the editor's live preview from a Node server, with `limitsForUserMaps` unless you pass other limits. |
| `ABSENT`, `isAbsent` | The "no value" marker: return `ABSENT` to leave the target field out. |

### Schemas and paths

| Export | What it is |
|---|---|
| `inferSchema(sample)` | A JSON Schema built from a sample document. See [Schemas](./maps/schemas.mdx). |
| `openApiSchemas(document)` | Every schema an OpenAPI document describes: `{ name, kind, description?, schema }`, each standing alone. |
| `xmlToJson(xml, schema?)`, `jsonToXml(value, schema?, options?)` | XML read into the JSON a map takes, and its output written back as XML, by the schema. See [XML](./maps/xml.mdx). |
| `xsdSchemas(xsd)`, `inferXmlSchema(xml)` | Schemas from an XSD, one per top-level element, or from a sample XML document. |
| `parseXml(xml)` | A safe XML parser: elements, attributes, text, namespaces, no DTD expansion. |
| `readFlatFile(text, schema?)`, `writeFlatFile(value, schema?)` | CSV and fixed-width files read into the JSON a map takes, and written back, by the schema. See [Flat files](./maps/flat-files.mdx). |
| `inferCsvSchema(text, options?)` | A schema from a sample CSV file. |
| `bundleSchema(schema, load, address?)` | The schema with `$ref`s to other files brought into `$defs`. `load` fetches a document by its address. |
| `listFields(schema)` | The schema flattened into tree rows: `path`, `name`, `depth`, `schema`, `repeating`. |
| `schemaAt(schema, path)` | The schema at a path, or `undefined`. |
| `parsePath(path)`, `childPath(parent, key, schema)`, `arrayScopes(path)` | Path helpers. |
| `isValueSchema(schema)` | True for a single value rather than an object or array. |

### Types

`MapDocument`, `OperatorNode`, `Link`, `LinkSource`, `LinkTarget`, `Loop`, `Schema`, `JsonValue`, `Value`, `OperatorDefinition`, `ValueOperator`, `AsyncValueOperator`, `AggregateOperator`, `OperatorContext`, `CategoryDefinition`, `RegistryOptions`, `OperatorCatalog`, `CatalogOperator`, `PreviewRequest`, `PreviewResponse`, `MapIssue`, `IssueCode`, `Transform`, `AsyncTransform`, `TransformOptions`, `AsyncTransformOptions`, `RunOptions`, `RunLimits`, `Field`.

## @crosswalkjs/canvas

### Hooking into the editor

The editor tells your page what's happening through the hooks you give `createMapper`, and answers questions through its methods. Switch a hook on, use the editor, and each call shows below it with what it was given; the buttons call the methods. The code underneath has the hooks that are on. [Embedding the editor](./editor/embedding.md#options) describes each one.

<ApiExplorer />

### Exports

| Export | What it is |
|---|---|
| `createMapper(element, options)` | Builds the editor. See [Embedding the editor](./editor/embedding.md). |
| `previewOverHttp(url, init?)` | A preview runner that posts to your server. See [Connecting to a server](./editor/server.md#live-preview). |
| `createMapView(element, options)` | A read-only view of a map: only mapped fields, laid out automatically, sized to fit. See [Read-only view](./editor/read-only-view.mdx). |
| `themes` | The built-in theme definitions. |
| `defineTheme(definition)` | Checks a theme definition. See [Your own themes](./themes/custom-themes.md). |
| `registerTheme(definition)` | Makes a theme available by id. |
| `listThemes()` | Built-in and registered themes. |
| `resolveTheme(theme)` | A theme with everything filled in from what it extends. |
| `themeStyles(resolved)` | A resolved theme's CSS. |
| `densities` | The sizes, in pixels, each `density` gives rows, operators and toolbox chips. |
| `englishLabels` | The editor's own wording: every label, with `Labels` as its type. See [In your own words](./editor/embedding.md#in-your-own-words). |
| `edits` | The editor's edits as pure functions over a map document, such as `connect`, `addNode` and `removeNode`. Useful for building maps in code. |
| `styles`, `injectStyles(document)` | The editor's base stylesheet, and the function that adds it to a page. |

### Types

`Mapper`, `MapperOptions`, `MapperSelection`, `Labels`, `PreviewOptions`, `PreviewRunner`, `MapView`, `MapViewOptions`, `ThemeDefinition`, `ResolvedTheme`, `ThemeColors`, `LinkStyle`, `GridStyle`, `Density`, `DragOrigin`, `DropTarget`, `Position`.
