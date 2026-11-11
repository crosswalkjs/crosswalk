---
title: The map document
description: The JSON format a map is saved in.
---

# The map document

A map is a plain JSON document. The editor reads and writes it, the engine runs it, and you can write one by hand.

```json
{
  "version": 1,
  "source": { "type": "object", "properties": { "...": {} } },
  "target": { "type": "object", "properties": { "...": {} } },
  "nodes": [
    { "id": "fullName", "operator": "text.concat", "constants": { "1": " " }, "position": { "x": 300, "y": 60 } }
  ],
  "links": [
    { "from": { "source": "FirstName" }, "to": { "node": "fullName", "input": 0 } },
    { "from": { "source": "LastName" }, "to": { "node": "fullName", "input": 2 } },
    { "from": { "node": "fullName" }, "to": { "target": "FullName" } }
  ],
  "loops": [{ "source": "PhoneCalls[]", "target": "Calls[]" }]
}
```

| Field | What it holds |
|---|---|
| `version` | Always `1` for now. A future format will change it. |
| `source`, `target` | A JSON Schema for each side. The root of each must be an object. |
| `nodes` | The operators on the grid. |
| `links` | Every line: from a source field or a node, to a target field or a node's input. |
| `loops` | Which source array each target array repeats over, and how. Optional. |
| `submaps` | Smaller maps, by name, for mapping one record to another. Optional. |
| `notes` | Notes for people reading the map. Runtimes ignore them. Optional. |
| `pages` | Pages the editor splits a busy map's operators across. Runtimes ignore them. Optional. |

## Schemas

`source` and `target` are JSON Schemas: the fields there are to map, which repeat, and which are required. Crosswalk reads the parts that describe shape, including `$ref`, `allOf`, `oneOf` and `anyOf`, and can take them from an OpenAPI document, schemas split across files, or a sample of the data. [Schemas](./schemas.mdx) has the detail.

`required` on the target says which fields a record must have. The editor marks them with `*`, and a required field with nothing mapped to it is a warning.

## Paths

Fields are addressed by path. Object keys are joined with `.`, and a field that repeats is written with `[]`:

| Path | Means |
|---|---|
| `FirstName` | The top-level `FirstName`. |
| `Billing.Total` | `Total` inside the `Billing` object. |
| `PhoneCalls[]` | One item of the `PhoneCalls` array. |
| `PhoneCalls[].Cost` | The `Cost` of each item in `PhoneCalls`. |
| `Tags[]` | Each value in an array of plain values. |

An array is always written with `[]`, so `PhoneCalls.Cost` isn't a valid path.

A key that contains `.`, `[` or `]` has a `\` before each of them, so the key `unit.price` is written `unit\.price` and `tags[]` is `tags\[\]`. A `[]` after it still means its array: `order\.lines[].unit\.price`. In JSON the backslash itself is escaped, so a link reads `{ "source": "unit\\.price" }`. The editor writes these for you.

## Nodes

```json
{ "id": "total", "operator": "aggregate.sum", "scope": "PhoneCalls[]", "position": { "x": 380, "y": 250 } }
```

| Field | What it holds |
|---|---|
| `id` | Unique within the map. Links refer to the node by it. |
| `operator` | The id of an operator in the registry, such as `text.concat`. See [Built-in operators](../operators/reference.mdx). |
| `constants` | Fixed values for inputs that aren't linked, keyed by input index. |
| `scope` | For an aggregate operator: the repeating record it aggregates over. |
| `position` | Where the editor draws the node. The engine ignores it. |
| `page` | The id of the page the editor draws the node on. The engine ignores it. |

## Links

A link goes **from** a source field or a node's output, **to** a target field or one input of a node:

```json
{ "from": { "source": "PhoneCalls[].Cost" }, "to": { "node": "total", "input": 0 } }
{ "from": { "node": "total" }, "to": { "target": "Billing.Total" } }
```

Each target field and each node input takes at most one link. A node's inputs are numbered from 0 with no gaps: every input up to the last one used needs either a link or a constant.

A link straight from a source field to a target field can have a `page`, the id of the page the editor draws it on. A link to or from a node is drawn on the node's page.

A constant can be any JSON value. **Look up** takes an object as its table:

```json
{ "id": "status", "operator": "convert.lookup", "constants": { "1": { "P": "Paid", "S": "Shipped" }, "2": "Unknown" } }
```

### Record links

A link can also join a source record to a target record, to fill the target record whole:

```json
{ "from": { "source": "Billing" }, "to": { "target": "BillTo" } }
{ "from": { "source": "Shipping" }, "to": { "target": "ShipTo" }, "submap": "Address" }
```

Without `submap` it copies the source record as it is. With one, it maps the record with that [sub-map](#sub-maps). A record link between a loop's source and target, such as `Lines[]` to `Products[]`, maps each item. Nothing else may write inside a record that a record link fills.

## Loops

A loop makes a target array repeat once per item of a source array:

```json
{ "source": "PhoneCalls[]", "target": "Calls[]" }
```

Inside the loop, `PhoneCalls[].Number` means the current call's number. Loops nest: a loop over `Orders[].Lines[]` sits inside one over `Orders[]`. [How a map runs](./how-maps-run.md) explains repetition in full.

A loop can also sort, group and leave out repeats:

```json
{
  "source": "Lines[]",
  "target": "Products[]",
  "sortBy": [{ "path": "Lines[].Date", "descending": true }],
  "groupBy": "Lines[].Sku",
  "distinct": true
}
```

| Field | What it does |
|---|---|
| `sortBy` | Orders the source items by these fields of the item, first key first. `descending` reverses one key. |
| `groupBy` | Makes one target item per distinct value of this field, rather than one per source item. |
| `distinct` | Leaves out a target item that's the same as an earlier one. |
| `page` | The id of the page the editor draws the loop on. The engine ignores it. |

[Sorting, grouping and repeats](./how-maps-run.md#sorting-grouping-and-repeats) covers what each does in detail.

## Sub-maps

A sub-map maps one record to another, and has the same parts as a map: `source` and `target` schemas for the two records, then `nodes`, `links`, `loops`, `notes` and `pages`. Record links use it by name, so one sub-map can serve every place the same kind of record turns up:

```json
"submaps": {
  "Address": {
    "source": { "type": "object", "properties": { "Street": { "type": "string" }, "City": { "type": "string" } } },
    "target": { "type": "object", "properties": { "Line1": { "type": "string" }, "Town": { "type": "string" } } },
    "nodes": [],
    "links": [
      { "from": { "source": "Street" }, "to": { "target": "Line1" } },
      { "from": { "source": "City" }, "to": { "target": "Town" } }
    ]
  }
}
```

Paths inside a sub-map start from its own records, so `Street` rather than `Billing.Street`. A sub-map can use other sub-maps, from the same `submaps` list, but not itself. An optional `title` names it for people.

## Notes

```json
{ "id": "note1", "text": "Check the rounding with finance.", "position": { "x": 260, "y": 200 } }
{ "id": "note2", "text": "Units add up across the SKU's lines.", "position": { "x": 24, "y": 22 }, "on": { "node": "units" } }
```

Notes sit on the editor's grid, in a map or a sub-map, to explain it to the next person. Runtimes ignore them.

A note can be pinned to what it's about with `on`, so it stays beside it when things move. Its `position` is then measured from that thing rather than from the grid's corner.

| `on` | Pins the note to |
|---|---|
| `{ "node": "units" }` | An operator. |
| `{ "node": "fullName", "input": 2 }` | One of an operator's inputs, and the line into it. |
| `{ "target": "Products[].Units" }` | A target field, and the line or loop into it. |
| `{ "source": "Lines[].Qty" }` | A source field. |

A note's `page` says which page it's on, like an operator's. A note pinned to an operator is on that operator's page, whatever its own `page` says.

## Pages

```json
"pages": [
  { "id": "page1", "name": "Header" },
  { "id": "page2", "name": "Lines" }
]
```

A busy map can be split across pages, each a tab along the bottom of the editor's grid. Each operator, note, loop and link straight across names its page with `page`; one with no `page`, or a page that isn't listed, is on the first. A link to or from an operator is on the operator's page. The source and target trees are on every page.

Pages only change what the editor draws together. The map runs the same however its operators are split, so a link can join operators on different pages. A sub-map has pages of its own.
