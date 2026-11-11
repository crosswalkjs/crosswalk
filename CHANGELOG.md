# Changelog

Crosswalk is at 0.1, so the API may change before 1.0. The npm packages and the NuGet package share a version.

## 0.1.0

The first release.

- **`@crosswalkjs/core`**: the map document, and running it. Schemas from JSON Schema, OpenAPI, XSD or a sample of the data. 41 built-in operators, and your own, sync or async. Loops, sub-maps and pages. XML and flat files (CSV, fixed-width, HL7, X12 and EDIFACT) in and out. Checks a map for problems before it runs.
- **`@crosswalkjs/canvas`**: the editor, in plain DOM. Source and target trees, an operator toolbox, a live preview of the output, notes, pages, undo and redo. A read-only view for showing a map on a page. 14 built-in themes, `ink` by default, and your own. Every piece of wording can be changed. On a phone, the map is a list of target fields, each opening a sheet with how it's made, step by step. Works in React, Vue, Svelte, Solid, Angular, Astro and as a web component.
- **`Crosswalk.Core`** (NuGet): runs the same maps in .NET 8 and later. It passes the same conformance suite as the JavaScript packages.
