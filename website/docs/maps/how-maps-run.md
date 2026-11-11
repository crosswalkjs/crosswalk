---
title: How a map runs
description: Missing values, gates, repetition, validation and errors.
---

# How a map runs

The engine builds the target by walking the target schema. For each field it follows the link backwards, through any operators, to the source.

## Missing values are left out

When a source field isn't there, it produces nothing. Nothing is different from `null`, which is a real JSON value, and most operators pass nothing straight through without running, so the target field is left out. A target field with no link is left out too.

```ts
run({ FirstName: "Ana" });
// { GivenName: "Ana" }: no LastName, so no FullName
```

A few operators are built to see nothing: **Exists** tests for it, **If / else** and **First of** choose between inputs that might be missing.

## Only if gates a value

**Only if** takes a condition and a value. When the condition is true the value passes through; otherwise the target field is left out:

```text
ZipCode ──► Is a number ──► Only if (condition)
ZipCode ──────────────────► Only if (value) ──► ZipCode
```

An object, or an array item, with nothing mapped into it is left out as well. So gating every field of an item with **Only if** filters the item out of the array.

## Repetition is explicit

A source path that goes through an array, such as `PhoneCalls[].Cost`, has a value per call. A target field outside any array has room for one value. Crosswalk won't guess which one, so you say:

- **Loop over it.** A [loop](./map-document.md#loops) makes a target array repeat once per source item, and inside it `PhoneCalls[].Cost` is the current call's cost.
- **Aggregate it.** An aggregate operator such as **Sum** or **Count** has a **scope**, the repeating record it runs over. It produces one value from all of them.

```json
{ "id": "total", "operator": "aggregate.sum", "scope": "PhoneCalls[]" }
```

Reading a repeating field into a single value with neither is a validation error, rather than a silent "first item".

Aggregates work inside loops too. Inside a loop over `Orders[]`, a **Sum** scoped to `Orders[].Lines[]` totals each order's own lines.

## Sorting, grouping and repeats

A loop can change what it repeats over. It does these in order: sort, then group, then leave out repeats.

**Sorting** orders the source items by one or more of their fields. It compares the way **Greater than** and the other comparisons do: numbers as numbers, otherwise as text, case-sensitive. Items that tie keep their order, and items missing the field go last, even when sorting largest first.

**Grouping** makes one target item per distinct value of a field, in the order each value first turns up. Items missing the field form a group of their own. Inside a group:

- a field reads from the group's first item, so sort first to choose which one that is.
- an aggregate scoped to the loop's source array covers just the group's items. That's how you total each group.

```json
{ "source": "Lines[]", "target": "Products[]", "sortBy": [{ "path": "Lines[].Date" }], "groupBy": "Lines[].Sku" }
```

With a **Sum** of `Lines[].Qty` scoped to `Lines[]`, this gives one product per SKU, its earliest date, and the total quantity across its lines.

**Leaving out repeats** drops a target item that's the same as one before it, comparing whole items as JSON. It looks at the output, so two different source items that map to the same thing count as repeats.

## Whole records and sub-maps

A [record link](./map-document.md#record-links) fills a target record from a source record in one go. Without a sub-map it copies the record exactly as it is, fields the target doesn't declare included. With a [sub-map](./map-document.md#sub-maps), it runs the sub-map with the source record as its input and puts the sub-map's output in the target record.

Either way, a missing source record leaves the target record out, and so does a sub-map that maps nothing. Inside a loop, a record link maps the current item.

A sub-map is checked once, however many places use it, and its issues come back once, with a `submap` field naming it and its name at the start of the message. Every field a sub-map reads or writes must exist in every pair of records it joins. A sub-map runs inside the same [limits](#limits) as the map that uses it.

## Validation

`analyseMap` checks a map against its schemas and operators without running it, and returns every issue it finds:

```ts
import { analyseMap, createRegistry } from "@crosswalkjs/core";

const { issues } = analyseMap(map, createRegistry());
for (const issue of issues) console.log(issue.severity, issue.code, issue.message);
```

Errors stop a map running. Warnings, such as an operator that feeds nothing, don't. Each issue names the `node`, `link` index or field `path` it's about, which is how the editor marks the right place.

| Code | Meaning |
|---|---|
| `unknown-source`, `unknown-target` | A link uses a path that isn't in the schema. |
| `not-a-value` | A link reads or writes an object or array, not a single value. |
| `unknown-operator`, `unknown-node` | A node uses an operator the registry doesn't have, or a link names a node that doesn't exist. |
| `duplicate-link` | A target field or node input has more than one link. |
| `missing-input`, `input-count`, `constant-and-link` | A node's inputs have a gap, the wrong count, or both a link and a constant on one input. |
| `cycle` | Operators feed each other in a loop. |
| `unbound-scope`, `missing-loop` | A repeating field is read without a loop or an aggregate. |
| `scope-required`, `unknown-scope`, `unexpected-scope` | An aggregate has no scope or a bad one, or a non-aggregate has one. |
| `loop-source`, `loop-target`, `duplicate-loop` | A loop names something that isn't an array, or a target array has two. |
| `bad-loop-key` | A loop sorts or groups by something that isn't a single value in its items. |
| `record-mismatch` | A record link doesn't have a record at both ends. |
| `conflicting-link` | Something writes inside a record that a record link already fills. |
| `unknown-submap`, `submap-cycle`, `submap-mismatch` | A record link names a sub-map that isn't there, sub-maps use each other in a circle, or a sub-map uses a field one of its records doesn't have. |
| `unused-node`, `scope-not-used` | Warnings: an operator feeds nothing, or an aggregate's input isn't inside its scope. |
| `copy-mismatch` | Warning: a record is copied as it is into one that declares different fields. A sub-map can rename them. |
| `unknown-ref` | A schema has a `$ref` to something its `$defs` or `definitions` don't have. |
| `required-unmapped` | Warning: a target field its schema requires has nothing mapped to it. It's only checked in records being filled: the root, and records with something mapped into them. |

## Running

```ts
import { createTransform, MapRuntimeError, MapValidationError } from "@crosswalkjs/core";

try {
  const run = createTransform(map, { registry });
  const output = run(input);
} catch (error) {
  if (error instanceof MapValidationError) console.log(error.issues);
  if (error instanceof MapRuntimeError) console.log(`Operator ${error.node} failed: ${error.message}`);
}
```

`createTransform` throws a `MapValidationError` when the map has errors. Running can still fail on the data itself, such as text where an operator needs a number, and that throws a `MapRuntimeError` naming the node.

`transform(map, input)` does both steps in one call, which suits a single run.

## Limits

A map someone draws in the browser could be huge, loop over a vast input, or build an enormous string. When you run maps you didn't write yourself, give them limits:

```ts
import { createTransform, limitsForUserMaps } from "@crosswalkjs/core";

const run = createTransform(map, { registry, limits: limitsForUserMaps });
```

| Limit | Caps | `limitsForUserMaps` |
|---|---|---|
| `maxNodes` | Operators in the map, checked when the transform is created. | 500 |
| `maxLinks` | Links in the map, checked when the transform is created. | 2,000 |
| `maxOperatorRuns` | Times operators run in one run. Each runs once per item it's needed for. | 1,000,000 |
| `maxOutputValues` | Values one run writes to the output: every field, object and array item. | 1,000,000 |
| `maxTextLength` | Characters of text any operator outputs. | 1,000,000 |
| `timeout` | Milliseconds a run may take. A synchronous run stops between steps; an async run also cancels operators it's waiting on. | 5,000 |

A transform has no limits unless you give it some. Leave any limit out for no cap, or start from the preset and change what you need: `{ ...limitsForUserMaps, timeout: 2000 }`.

Going past a limit throws a `MapLimitError` whose `limit` names it, and whose `node` names the operator when there is one. The map-size limits throw when the transform is created, before the map is even analysed, so an oversized map costs almost nothing to refuse.

Limits don't cover the input's own size: cap that where the input arrives, such as your server's request size limit.

## Operators that wait

A map that uses an [async operator](../operators/custom-operators.md#operators-that-wait), such as a lookup, runs with `createAsyncTransform`. It works for every map, so code that may meet either kind can always use it:

```ts
import { createAsyncTransform } from "@crosswalkjs/core";

const run = createAsyncTransform(map, { registry, concurrency: 8 });

const output = await run(input, { signal: AbortSignal.timeout(5000) });
```

- **`concurrency`** caps how many async operator calls one run has waiting at once, 8 by default. A loop over 1,000 items with a lookup then makes at most 8 requests at a time, not 1,000.
- **`signal`** cancels the run, such as after a timeout. The run rejects with the signal's reason (an `AbortError`, or a `TimeoutError` from `AbortSignal.timeout`), and async operators get the signal to stop their own work.
- An operator runs once per item, however many fields it feeds, so a lookup isn't repeated.
- A map with no async operators gives the same result either way. The [conformance suite](https://github.com/crosswalkjs/crosswalk/tree/main/conformance) runs every case through both.

`createTransform` stays synchronous, and refuses a map that uses an async operator, naming the operators, so the problem shows when the map loads rather than partway through a run.

With a `timeout` limit, an async run also stops waiting operators when time runs out, and fails with a `MapLimitError` rather than an `AbortError`. Your own `signal` still fails with whatever its reason is.
