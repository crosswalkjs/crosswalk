import {
  analyseMap,
  createRegistry,
  createTransform,
  defineCategory,
  defineOperator,
  inferSchema,
  toText,
  type JsonValue,
  type MapDocument,
} from "@crosswalkjs/core";
import { createMapper, createMapView, defineTheme, listThemes, registerTheme, type MapView } from "@crosswalkjs/canvas";
import personMap from "../packages/core/test/fixtures/person.map.json";
import personInput from "../packages/core/test/fixtures/person.input.json";

// The Person map's own operator, in a category of the playground's own: the
// library has no date arithmetic, so the host supplies it.
const people = defineCategory({ id: "people", label: "People", color: "#0e9f6e" });

const age = defineOperator({
  kind: "value",
  id: "example.age",
  label: "Age",
  glyph: "Ag",
  category: "people",
  inputs: { min: 1, max: 1 },
  run: ([dateOfBirth]) => {
    const today = new Date();
    const born = new Date(`${toText(dateOfBirth ?? null)}T00:00:00Z`);
    if (Number.isNaN(born.getTime())) throw new Error(`"${toText(dateOfBirth ?? null)}" isn't a date`);
    const birthdayPassed =
      today.getUTCMonth() > born.getUTCMonth() ||
      (today.getUTCMonth() === born.getUTCMonth() && today.getUTCDate() >= born.getUTCDate());
    return today.getUTCFullYear() - born.getUTCFullYear() - (birthdayPassed ? 0 : 1);
  },
});

const registry = createRegistry({ categories: [people], operators: [age] });

// An example of a theme of your own: Nord's colours with a pink accent, right-angled links and round tiles.
registerTheme(
  defineTheme({
    id: "aurora",
    label: "Aurora (custom example)",
    description: "A custom theme: extends Nord and changes the accent, link style and tile shape.",
    group: "Your themes",
    extends: "nord",
    colors: { accent: "#f5a3c7", accentSoft: "rgba(245, 163, 199, .18)", link: "#6d7a96" },
    categories: { people: "#a3be8c" },
    links: "elbow",
    shape: { node: "50%", chip: "50%" },
  }),
);

const callsMap: MapDocument = {
  version: 1,
  source: (personMap as MapDocument).source,
  target: {
    type: "object",
    properties: {
      Calls: {
        type: "array",
        items: {
          type: "object",
          properties: { Number: { type: "string" }, Cost: { type: "number" }, Kind: { type: "string" } },
        },
      },
    },
  },
  loops: [{ source: "PhoneCalls[]", target: "Calls[]" }],
  nodes: [
    { id: "prefix", operator: "text.left", constants: { 1: 4 } },
    { id: "isNational", operator: "logic.equal", constants: { 1: "+351" } },
    { id: "kind", operator: "flow.ifElse", constants: { 1: "national", 2: "international" } },
  ],
  links: [
    { from: { source: "PhoneCalls[].PhoneNumber" }, to: { target: "Calls[].Number" } },
    { from: { source: "PhoneCalls[].Cost" }, to: { target: "Calls[].Cost" } },
    { from: { source: "PhoneCalls[].PhoneNumber" }, to: { node: "prefix", input: 0 } },
    { from: { node: "prefix" }, to: { node: "isNational", input: 0 } },
    { from: { node: "isNational" }, to: { node: "kind", input: 0 } },
    { from: { node: "kind" }, to: { target: "Calls[].Kind" } },
  ],
};

const blankMap: MapDocument = {
  version: 1,
  source: (personMap as MapDocument).source,
  target: (personMap as MapDocument).target,
  nodes: [],
  links: [],
};

// Grouping, a lookup table, a sub-map used twice and a note.
const address = (...fields: string[]) => ({ type: "object" as const, properties: Object.fromEntries(fields.map((f) => [f, { type: "string" as const }])) });
const orderMap: MapDocument = {
  version: 1,
  source: {
    type: "object",
    title: "Order",
    properties: {
      Number: { type: "string" },
      Status: { type: "string" },
      Billing: address("Street", "City", "Postcode"),
      Shipping: address("Street", "City", "Postcode"),
      Lines: {
        type: "array",
        items: { type: "object", properties: { Sku: { type: "string" }, Date: { type: "string" }, Qty: { type: "number" } } },
      },
    },
  },
  target: {
    type: "object",
    title: "Invoice",
    properties: {
      Reference: { type: "string" },
      Status: { type: "string" },
      BillTo: address("Line1", "Town", "Postcode"),
      ShipTo: address("Line1", "Town", "Postcode"),
      Products: {
        type: "array",
        items: { type: "object", properties: { Sku: { type: "string" }, Units: { type: "number" }, FirstOrdered: { type: "string" } } },
      },
    },
  },
  loops: [{ source: "Lines[]", target: "Products[]", sortBy: [{ path: "Lines[].Date" }], groupBy: "Lines[].Sku" }],
  nodes: [
    { id: "status", operator: "convert.lookup", constants: { 1: { P: "Paid", S: "Shipped", C: "Cancelled" }, 2: "Unknown" }, position: { x: 150, y: 50 } },
    { id: "units", operator: "aggregate.sum", scope: "Lines[]", position: { x: 150, y: 290 } },
  ],
  links: [
    { from: { source: "Number" }, to: { target: "Reference" } },
    { from: { source: "Status" }, to: { node: "status", input: 0 } },
    { from: { node: "status" }, to: { target: "Status" } },
    { from: { source: "Billing" }, to: { target: "BillTo" }, submap: "Address" },
    { from: { source: "Shipping" }, to: { target: "ShipTo" }, submap: "Address" },
    { from: { source: "Lines[].Sku" }, to: { target: "Products[].Sku" } },
    { from: { source: "Lines[].Qty" }, to: { node: "units", input: 0 } },
    { from: { node: "units" }, to: { target: "Products[].Units" } },
    { from: { source: "Lines[].Date" }, to: { target: "Products[].FirstOrdered" } },
  ],
  notes: [
    {
      id: "note1",
      text: "One product per SKU, earliest order first. Units add up across the SKU's lines.",
      position: { x: 24, y: 22 },
      on: { node: "units" },
    },
  ],
  submaps: {
    Address: {
      source: { ...address("Street", "City", "Postcode"), title: "Address" },
      target: { ...address("Line1", "Town", "Postcode"), title: "Address" },
      nodes: [{ id: "postcode", operator: "text.upper", position: { x: 160, y: 90 } }],
      links: [
        { from: { source: "Street" }, to: { target: "Line1" } },
        { from: { source: "City" }, to: { target: "Town" } },
        { from: { source: "Postcode" }, to: { node: "postcode", input: 0 } },
        { from: { node: "postcode" }, to: { target: "Postcode" } },
      ],
      notes: [{ id: "note1", text: "Both addresses on the order use this.", position: { x: 120, y: 190 } }],
    },
  },
};

const orderInput: JsonValue = {
  Number: "SO-1042",
  Status: "S",
  Billing: { Street: "4 Mill Lane", City: "Leeds", Postcode: "ls1 4ab" },
  Shipping: { Street: "Unit 9, Canal Wharf", City: "Leeds", Postcode: "ls11 5pq" },
  Lines: [
    { Sku: "MUG-01", Date: "2026-03-04", Qty: 2 },
    { Sku: "TEA-12", Date: "2026-03-01", Qty: 1 },
    { Sku: "MUG-01", Date: "2026-03-02", Qty: 4 },
  ],
};

const examples: Record<string, { map: MapDocument; input: JsonValue }> = {
  "Order to invoice (groups, lookup, sub-map)": { map: orderMap, input: orderInput },
  "Person": { map: personMap as MapDocument, input: personInput },
  "Phone calls (loop)": { map: callsMap, input: personInput },
  "Blank Person map": { map: blankMap, input: personInput },
};

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const exampleSelect = element<HTMLSelectElement>("example");
const mapText = element<HTMLTextAreaElement>("map");
const inputText = element<HTMLTextAreaElement>("input");
const output = element<HTMLPreElement>("output");
const issuesList = element<HTMLUListElement>("issues");
const status = element<HTMLSpanElement>("status");
const drawer = element<HTMLElement>("drawer");
const drawerToggle = element<HTMLButtonElement>("drawer-toggle");
const drawerSummary = element<HTMLSpanElement>("drawer-summary");

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function parse(text: string, what: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new Error(`The ${what} isn't valid JSON: ${(error as Error).message}`);
  }
}

/** Just enough of a check that the canvas can draw it; analyseMap reports the rest. */
function looksLikeMap(value: JsonValue): value is JsonValue & MapDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { source, target, nodes, links } = value;
  const isObject = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
  return isObject(source) && isObject(target) && Array.isArray(nodes) && Array.isArray(links);
}

function showIssues(items: { severity: "error" | "warning"; message: string }[]) {
  issuesList.replaceChildren(
    ...(items.length === 0
      ? [Object.assign(document.createElement("li"), { className: "none", textContent: "None" })]
      : items.map((item) => Object.assign(document.createElement("li"), { className: item.severity, textContent: item.message }))),
  );
}

function setStatus(text: string, kind: "ok" | "error") {
  status.textContent = text;
  status.className = kind;
  // The drawer's bar says how things stand, so it's still useful collapsed.
  const errors = issuesList.querySelectorAll(".error").length;
  const warnings = issuesList.querySelectorAll(".warning").length;
  const counts = [errors && `${errors} error${errors === 1 ? "" : "s"}`, warnings && `${warnings} warning${warnings === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(", ");
  const summary = document.createElement("span");
  summary.textContent = counts || "No issues";
  if (errors) summary.className = "error";
  drawerSummary.replaceChildren(summary);
}

const DRAWER_KEY = "crosswalk.playground.drawer";

function setDrawer(open: boolean) {
  drawer.classList.toggle("open", open);
  drawerToggle.setAttribute("aria-expanded", String(open));
  remember(DRAWER_KEY, open ? "open" : "closed");
}

drawerToggle.addEventListener("click", () => setDrawer(!drawer.classList.contains("open")));

/** Runs the map in the map editor against the input, and shows the result. */
function update() {
  let map: JsonValue;
  let input: JsonValue;
  try {
    map = parse(mapText.value, "map");
    input = parse(inputText.value, "input");
  } catch (error) {
    output.textContent = "";
    showIssues([{ severity: "error", message: (error as Error).message }]);
    return setStatus("Invalid JSON", "error");
  }
  if (!looksLikeMap(map)) {
    output.textContent = "";
    showIssues([{ severity: "error", message: "The map needs source and target schemas, and nodes and links arrays." }]);
    return setStatus("Invalid map", "error");
  }

  const issues = analyseMap(map, registry).issues;
  showIssues(issues);
  if (issues.some((issue) => issue.severity === "error")) {
    output.textContent = "";
    return setStatus("The map has errors", "error");
  }

  try {
    const started = performance.now();
    output.textContent = pretty(createTransform(map, { registry })(input));
    setStatus(`Mapped in ${(performance.now() - started).toFixed(1)} ms`, "ok");
  } catch (error) {
    output.textContent = "";
    showIssues([...issues, { severity: "error", message: (error as Error).message }]);
    setStatus("The map failed while running", "error");
  }
}

const TOOLBOX_KEY = "crosswalk.playground.toolbox";
const THEME_KEY = "crosswalk.playground.theme";

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the page still works for this visit.
  }
}

const savedTheme = listThemes().find((t) => t.id === remembered(THEME_KEY))?.id ?? "studio";

// The editor, or a read-only summary of the same map, in the same theme.
/** The input pane's JSON, for the editor's preview, or undefined while it isn't valid. */
const previewInput = (): JsonValue | undefined => {
  try {
    return JSON.parse(inputText.value) as JsonValue;
  } catch {
    return undefined;
  }
};

const createEditor = (document: MapDocument, theme: string): MapView =>
  createMapper(element("canvas"), {
    document,
    registry,
    theme,
    preview: { input: previewInput() ?? {} },
    toolboxCollapsed: remembered(TOOLBOX_KEY) === "collapsed",
    onToolboxToggle: (collapsed) => remember(TOOLBOX_KEY, collapsed ? "collapsed" : "open"),
    onChange(updated) {
      mapText.value = pretty(updated);
      update();
    },
  });
const createSummary = (document: MapDocument, theme: string): MapView =>
  createMapView(element("canvas"), { document, registry, theme, preview: { input: previewInput() ?? {} } });

let currentTheme: string = savedTheme;
let mapper = createEditor(blankMap, currentTheme);

const viewSelect = element<HTMLSelectElement>("view");
viewSelect.addEventListener("change", () => {
  const document = mapper.getDocument();
  mapper.destroy();
  mapper = viewSelect.value === "summary" ? createSummary(document, currentTheme) : createEditor(document, currentTheme);
});

function load(name: string) {
  const example = examples[name];
  if (!example) return;
  mapText.value = pretty(example.map);
  inputText.value = pretty(example.input);
  mapper.setDocument(example.map);
  mapper.setPreviewInput(previewInput());
  update();
}

if (remembered(DRAWER_KEY) === "closed") setDrawer(false);

/** Gives the page around the editor the active theme's colours, read from the editor itself. */
function matchPageToTheme() {
  const editor = document.querySelector<HTMLElement>(".cw-root");
  if (!editor) return;
  const style = getComputedStyle(editor);
  const copy: Record<string, string> = {
    "--bg": "--cw-bg",
    "--panel": "--cw-panel",
    "--text": "--cw-text",
    "--muted": "--cw-muted",
    "--faint": "--cw-faint",
    "--border": "--cw-border",
    "--hover": "--cw-hover",
    "--accent": "--cw-accent",
    "--accent-soft": "--cw-accent-soft",
    "--error": "--cw-error",
  };
  for (const [page, theme] of Object.entries(copy)) document.body.style.setProperty(page, style.getPropertyValue(theme).trim());
  // Pick status colours and native controls to suit how light the background is.
  const [r = 0, g = 0, b = 0] = (style.backgroundColor.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  document.body.style.colorScheme = dark ? "dark" : "light";
  document.body.style.setProperty("--ok", dark ? "#4fd38a" : "#1a7f45");
  document.body.style.setProperty("--warning", dark ? "#f0b252" : "#b26b00");
}

const themeSelect = element<HTMLSelectElement>("theme");
// One group per theme group, in the order the groups first appear.
const themeGroups = new Map<string, HTMLOptGroupElement>();
for (const theme of listThemes()) {
  const label = theme.group ?? "Custom";
  let optgroup = themeGroups.get(label);
  if (!optgroup) {
    optgroup = Object.assign(document.createElement("optgroup"), { label });
    themeGroups.set(label, optgroup);
    themeSelect.append(optgroup);
  }
  optgroup.append(Object.assign(new Option(theme.label, theme.id, false, theme.id === savedTheme), { title: theme.description ?? "" }));
}
themeSelect.addEventListener("change", () => {
  const theme = themeSelect.value;
  currentTheme = theme;
  mapper.setTheme(theme);
  matchPageToTheme();
  remember(THEME_KEY, theme);
});
matchPageToTheme();
// Studio and Classic follow the system's light or dark mode, so the page follows it too.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", matchPageToTheme);

exampleSelect.append(...Object.keys(examples).map((name) => new Option(name, name)));
exampleSelect.addEventListener("change", () => load(exampleSelect.value));

element<HTMLButtonElement>("infer").addEventListener("click", () => {
  try {
    const input = parse(inputText.value, "input");
    const document = { ...mapper.getDocument(), source: inferSchema(input) };
    mapper.setDocument(document);
    mapText.value = pretty(document);
    update();
  } catch (error) {
    showIssues([{ severity: "error", message: (error as Error).message }]);
    setStatus("Invalid JSON", "error");
  }
});

let pending: number | undefined;
mapText.addEventListener("input", () => {
  clearTimeout(pending);
  pending = window.setTimeout(() => {
    try {
      const map = JSON.parse(mapText.value) as JsonValue;
      if (looksLikeMap(map)) mapper.setDocument(map);
    } catch {
      // update() reports the bad JSON.
    }
    update();
  }, 150);
});
inputText.addEventListener("input", () => {
  clearTimeout(pending);
  pending = window.setTimeout(() => {
    update();
    mapper.setPreviewInput(previewInput());
  }, 150);
});

load(exampleSelect.value);
