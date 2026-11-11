# Conformance suite

What a Crosswalk map means, as test cases. Every runtime must pass all of them: the TypeScript core runs them in `packages/core/test/conformance.test.ts`, and the .NET runtime in `dotnet/tests/Crosswalk.Core.Tests/ConformanceTests.cs`. A runtime in another language runs the same files. If two runtimes disagree about a map, a case here is missing.

The cases use built-in operators only.

## Layout

```
conformance/
  operators.json          what each built-in operator does
  maps/<case>/
    case.json             { "description": "..." }
    map.json              a map document, exactly as the editor saves it
    input.json            the input to run it on
    expected.json         the output it must produce
    expected-error.json   or: the run must fail, { "node": "<id>" } naming the node that failed
    expected-issues.json  or: the map must be rejected, with these issues
    limits.json           optional: run with these limits
    expected-limit.json   or: a limit must stop the map, { "limit": "...", "node"?: "..." }
  number-text.json        [number, text] pairs: how numbers become text
  catalog.json            the built-in operators and categories, as every runtime describes them
```

A map case has exactly one of `expected.json`, `expected-error.json`, `expected-issues.json` or `expected-limit.json`. Cases with `expected-issues.json` have no `input.json`.

## Markers

Two values can't be written as plain JSON, so the suite uses markers:

| Marker | Means |
|---|---|
| `{ "$absent": true }` | No value. In inputs, a link from a source field the input doesn't have. In expectations, the output field is left out. This is different from `null`, which is a value. |
| `{ "$error": true }` | The run fails with a runtime error from the operator. |

## operators.json

```json
{
  "value": [{ "operator": "text.left", "inputs": ["+351917777777", 4], "expected": "+351", "note": "..." }],
  "aggregate": [{ "operator": "aggregate.sum", "values": [1, "2", 3.5], "expected": 6.5 }]
}
```

To run a **value** case, build a map with one node using `operator`, and an output field `out` linked from it. Each input is a constant on that input index, or for `$absent`, a link from a source field the input doesn't have. Run it on `{}`.

To run an **aggregate** case, build a map whose source has `items`, an array of objects with a field `v`. Give the node the scope `items[]`, link `items[].v` to its input 0 and its output to `out`. Run it on `{ "items": [...] }` with one item per value: `{ "v": value }`, or `{}` for `$absent`.

Either way, the output is `{ "out": expected }`, or `{}` when `expected` is `$absent`, or the run throws when it's `$error`. Building the map this way means operator cases go through the same validation and evaluation as real maps.

## number-text.json

Pairs of a number and its text, generated from JavaScript's `String(n)` across every magnitude. A runtime's "text of a number" (used by `To text`, `Concatenate` and the rest) must give exactly that text for each one. See "Text of a number" below.

## catalog.json

The catalogue of the built-in operators and categories: what a runtime's "to catalogue" gives for a registry of every built-in. Every runtime must give exactly this, so an editor shows the same toolbox whichever runtime serves it. Compare it as JSON, ignoring key order.

## expected-issues.json

```json
[{ "severity": "error", "code": "unbound-scope", "path": "PhoneBilling.TotalNational" }]
```

The map's issues must match the list exactly, in any order: one reported issue per expected issue, and no others. An expected issue matches on `severity`, `code`, and `node`, `path` and `submap` when it gives them. Messages aren't compared, because they're for people. The codes are listed in the docs under "How a map runs".

## Limits

A case with `limits.json` runs with those limits. `expected-limit.json` names the limit that must stop it, either when the transform is created (`maxNodes`, `maxLinks`) or during the run, and the node when the limit is about one. The counting is exact, so cases sit right on the boundary:

- **`maxOperatorRuns`** counts each time a node is evaluated: once per node per item it's needed for, however many fields it feeds. It includes aggregates, once each, and operators skipped because an input has no value.
- **`maxOutputValues`** counts every value written into the output, whether a field, an object or an array item. Values left out aren't counted, and neither is the root object.
- **`maxTextLength`** applies to text any operator outputs, including text it passes through as Only if does, in UTF-16 code units. Text linked straight from the input to the output isn't checked.
- **`timeout`** depends on the machine, so no case uses it.

## xml/

How a runtime reads XML into the JSON a map takes, and writes a map's output back as XML. Each folder has a `case.json` with a description, an optional `schema.json`, and either `input.xml` with `expected.json` (reading, compared as JSON; `{"$error": true}` when the document must be refused) or `input.json` with `expected.xml` (writing, compared as text, exactly).

- The root element is the root record. Child elements are fields by local name, prefixes dropped. Attributes in no namespace are fields too, where the schema marks them `xml: { attribute: true }` (or `nodeType: "attribute"`); `xml.name` gives a name that differs from the field's. An element's text beside attributes is the field marked `xml: { nodeType: "text" }`.
- With a schema, fields are read in its order, and only those. An array reads every child element of its item's name, or, with `xml.wrapped`, those inside an element of the array's name. A value takes the schema's type: `integer` and `number` read a finite decimal number (spaces around allowed), `boolean` reads `true`/`1` and `false`/`0`, and anything that doesn't read stays text, as written. `xsi:nil="true"` is `null`.
- Without a schema, attributes then elements are text fields, an element that repeats is an array, an element with neither children nor attributes is its text, and text beside them is `#text`, trimmed.
- A DOCTYPE is skipped and its entities never expanded; a reference to an entity other than XML's five, or a character reference, refuses the document.
- Writing: the root's name is `xml.name`, then the schema's title, then `root`; `xml.namespace` declares the default namespace (or `xml.prefix`'s). Each record writes its attributes, then its text, then its elements: fields in the schema's order, then any others. Arrays write one element per item; `null` and missing fields write nothing. Text escapes `&`, `<` and `>`, attributes `"` too, and numbers are written as in `number-text.json`. Two-space indents, a newline after each line, and the XML declaration first.

## flat/

How a runtime reads CSV and fixed-width files into JSON, and writes them back. Each folder has a `case.json`, an optional `schema.json`, and either `input.txt` with `expected.json` (reading, compared as JSON; `{"$error": true}` when the file must be refused) or `input.json` with `expected.txt` (writing, compared as text, exactly) or with `expected.json` of `{"$error": true}` (writing must fail).

- The file is the root record, with one array field holding a record per line: the root schema's first array field, or `rows`. Its items' fields are the columns, in order. The root's `flat` gives `format` (`csv`, the default, or `fixed`), and `delimiter` (`,`), `quote` (`"`), `header` (true for CSV, false for fixed-width), `skip` (lines before any header) and `lineEnding` (`\n`, for writing). A column's `flat` gives `name` (its heading), and for fixed-width `width`, `align`, `pad` (a space) and `decimals`.
- Reading CSV: a byte-order mark is dropped; fields are split as RFC 4180 has it, quoted fields holding the delimiter, doubled quotes and line breaks, at `\r\n`, `\n` or `\r`; an unclosed quote refuses the file. After `skip`, lines with a single blank field are dropped, and the header, if any, is trimmed. A column is found by its heading, or without a header by its place. Without a schema, every heading (or `column1`, `column2`, …) is a text field.
- Reading fixed-width: lines split at `\r\n` or `\n`; after `skip` and the header, blank lines are dropped; each column is the next `width` characters, trimmed.
- Values: an empty (or blank) field is left out. `integer` and `number` read a plain decimal (sign, digits, point, exponent) and, in fixed-width, divide by 10 to the power of `decimals`; `boolean` reads `true`/`1` and `false`/`0`, any case. Anything else stays text: as written in CSV, trimmed in fixed-width.
- Writing CSV: the header has each column's heading; a line per row item, missing or `null` cells empty; a field is quoted, its quotes doubled, when it holds the delimiter, the quote, a line break, or starts or ends with white space. Numbers as in `number-text.json`.
- Several kinds of line: a field whose `flat.tag` is set, on it or on its items, is a kind of line rather than a column; a record for one line, an array for many. Its record's other fields are its columns, and its own tagged fields are kinds of line that follow it. A CSV line's first field is its tag, trimmed, and its columns come after; a fixed-width line starts with its tag, and its columns start after it. There's no header, and blank lines are dropped. Lines are read in order: each belongs to the nearest record that has its kind, the innermost first; a second line of a single record's kind ends that record. A line no record has a kind for, or that's left over, refuses the file. Writing puts each record's line, then the lines of its kinds in the schema's order, a CSV line being its tag then its cells.
- Repeating groups: a column that's an array, rather than a kind of line, repeats within its line. Its items are records whose fields are its parts, or single values. In fixed-width, items follow one another, each as wide as its parts: `count` of them, blank ones skipped, or, without a count, to the end of the line. In CSV, with its own `delimiter` the group is one field split into items, each split into parts by the items' `delimiter` (needed when they have more than one part); without, its items take the fields that follow, `count` groups of them or the rest. A group that takes the rest of the line must be the last column, and in a CSV file with a header a group needs a delimiter; otherwise the file is refused. Empty items are left out, and an empty group too. Writing joins or pads the same way, blank slots as spaces in fixed-width and empty fields in CSV; more items than `count` is an error.
- Record columns: a column that's a record with fields, rather than a kind of line, is its parts: one after another in fixed-width, and in CSV one field split by its `delimiter`. All parts empty leaves it out; writing joins them, an empty field when they're all empty.
- Nesting: a record column's parts and a group's items can themselves be records or groups, as deep as the schema goes. In CSV each level within a field needs its `delimiter`; in fixed-width, a group inside another value needs a `count`, or the schema is refused. Writing leaves off empty parts at the end of a record within a field.
- EDI: the root's `terminator` ends lines instead of line breaks, which are skipped after it; a file with a terminator or `release` quotes nothing unless it gives a `quote`. The `release` character makes the one after it plain text in fields, parts and repeats, and writing releases every separator the schema uses (its delimiters, terminator and release). Each written line ends with the terminator, then `lineEnding` if given (none by default), and a line with a terminator leaves off empty fields at its end. A fixed-width file can have a terminator too. `lineEnding` can be `\r`.
- A CSV column with a `width` is trimmed when reading and padded when writing, as fixed-width cells are, a missing value included.
- Writing fixed-width: a number with `decimals` is multiplied out and rounded halves up; text longer than the width is an error; numbers align right and the rest left by default, padded with `pad`, a zero-padded negative keeping its `-` in front. Headings are text padded with spaces. Each line, including the last, ends with `lineEnding`.

## Comparing output

Output is compared as JSON, ignoring key order. Numbers are equal when they're within `1e-9` of each other, relative to the expected value's size, so a runtime may add up in a different order.

## Rules the cases rely on

These are the parts of the behaviour a port is most likely to get wrong:

- **Paths.** Keys are joined with `.`, an array is written `key[]`, and a `\` makes the next character part of the key, so `unit\.price` is the key `unit.price` and `tags\[\]` is `tags[]`. Anything else, such as an empty key, `[` not followed by `]`, or something after `[]` other than `.`, is an invalid path.
- **Schemas.** A `$ref` to `#/$defs/<name>` or `#/definitions/<name>` on the root schema stands for that schema, with anything written beside it added. A reference back to a schema it's already inside stops there, as a record with no fields. `allOf` is merged in: the schema's own fields first, then each part's new fields in order, fields both have merged, and `required` everything any requires. `oneOf` and `anyOf` drop `null` alternatives and read as one shape: records as one record with every alternative's fields in order, required only where every alternative requires them; arrays with their items read the same way; alternatives of different types as the first. A `type` list reads as its first type that isn't `null`, and a schema without `type` is a record if it has `properties`, an array if it has `items`, and otherwise a record. A required target field is a warning only where its record is being filled: the root, or a record something maps into, and not inside a record link.
- **Missing isn't null.** A source field that isn't there, or an `Only if` that's closed, produces no value, and the target field is left out. `null` is a value: it's copied, counted and compared like any other.
- **Numbers in text.** Text is numeric only if, after trimming spaces, it's a plain decimal number: an optional sign, digits with an optional fraction, and an optional exponent. `"0x10"`, `"Infinity"` and `"1_000"` are text.
- **Comparing.** Two values compare as numbers when both are numeric (numbers, or numeric text), and otherwise as text. Text compares by UTF-16 code unit, so it's case-sensitive and capitals sort before lower case. `null` reads as empty text.
- **True and false.** `true`, `false`, the text `"true"` and `"false"`, and numbers (non-zero is true) read as booleans. Anything else is an error.
- **Rounding** is half away from zero, on the decimal value as written: `2.5` gives `3`, `-2.5` gives `-3` and `1.005` to 2 places gives `1.01`. In .NET that's `Math.Round(decimal, digits, MidpointRounding.AwayFromZero)`.
- **Text of a number** follows JavaScript's rules: the shortest digits that read back as the same number, written plainly (`12`, `12.5`, `0.1`, `100000000000000000000`) from 1e-6 up to 1e21, and with an exponent outside that (`1e+21`, `1e-7`). A runtime whose own number formatting differs, such as .NET's `1E+20`, converts.
- **Text length** counts UTF-16 code units, and case changes are locale-independent.
- **Sorting, grouping, distinct.** A loop sorts its source items first, then groups them, then drops repeated target items. The sort is stable, compares like `compare`, and puts missing values (absent or `null`) last, even when descending. Groups come in the order their keys first appear; keys that compare equal share a group, and items missing the key form one group. Inside a group, a field reads from the group's first item, and an aggregate whose scope is the loop's source array covers only the group. Distinct compares whole target items as JSON, ignoring key order.
- **Record links.** A link with a record at either end joins two records, and needs a record at both. Without a sub-map it copies the source record as it is, counting every value inside it as written. With one, it runs the sub-map with the source record as input and writes its output. A missing source record, or an empty output, leaves the target record out. Inside a loop, it maps the current item. Nothing else may write inside a record a record link fills.
- **Sub-maps** are checked once each, with their issues reported once, prefixed with the sub-map's name. Every field a sub-map reads or writes must exist in the records it joins, and sub-maps may use each other but not in a cycle. A sub-map runs with the same limits as the map that uses it.
- **Empty containers.** An object with nothing mapped into it is left out, and so is an array item. A loop over an empty source array gives an empty array. A loop over a missing one leaves the target array out.
- **Notes** in a map or a sub-map are for the people reading it. Runtimes ignore them.
