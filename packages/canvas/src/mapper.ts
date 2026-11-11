import {
  analyseMap,
  createRegistry,
  handlePreview,
  isValueSchema,
  inferSchema,
  inferCsvSchema,
  inferXmlSchema,
  listFields,
  openApiSchemas,
  parsePath,
  resolveSchema,
  xsdSchemas,
  type OperatorDefinition,
  type OperatorRegistry,
  type JsonValue,
  type Link,
  type LinkSource,
  type Loop,
  type SortKey,
  type LinkTarget,
  type MapDocument,
  type MapIssue,
  type Note,
  type NoteAnchor,
  type PreviewResponse,
  type Schema,
} from "@crosswalkjs/core";
import * as edits from "./edits.js";
import { formatConstant, parseConstant } from "./recipes.js";
import { createPhoneView } from "./phone.js";
import { recordEnds, recordMappings, sourcesOf as sourcesIn } from "./records.js";
import { traceChain, traceFields, type Chain } from "./trace.js";
import type { DragOrigin, DropTarget, Position } from "./edits.js";
import type { PreviewRunner } from "./preview.js";
import { injectStyle, injectStyles } from "./styles.js";
import { englishLabels, type Labels } from "./labels.js";
import { densities, resolveTheme, themeStyles, type LinkStyle, type ResolvedTheme, type ThemeDefinition } from "./themes.js";

export interface MapperOptions {
  document: MapDocument;
  /** Defaults to the built-in operators. See `createRegistry` for choosing or adding your own. */
  registry?: OperatorRegistry;
  /** Called with a copy of the document after every edit made in the editor. */
  onChange?: (document: MapDocument) => void;
  /** A built-in or registered theme's id, or your own definition. Defaults to `ink`. */
  theme?: string | ThemeDefinition;
  /**
   * Starts the operator toolbox collapsed to a narrow rail, or open. Leave it
   * out and the toolbox collapses by itself while the editor is narrower than
   * 720px, until someone opens or closes it.
   */
  toolboxCollapsed?: boolean;
  /**
   * Called when the toolbox is collapsed or expanded, so a host can remember it.
   * `automatic` is true when it folded or opened by itself as the editor's width
   * changed, which a host usually shouldn't remember as a choice.
   */
  onToolboxToggle?: (collapsed: boolean, automatic: boolean) => void;
  /** Shows the map without letting anyone change it: no toolbox, dragging, inspector or editing keys. */
  readOnly?: boolean;
  /** Hides source and target fields that nothing maps to or from, keeping the records they sit in. */
  mappedOnly?: boolean;
  /** Places operators between the fields they connect, ignoring their saved positions. */
  autoLayout?: boolean;
  /** Sizes the editor to its content, rather than filling its container. */
  fitContent?: boolean;
  /**
   * On a phone-sized screen, shows the map as a list of target fields, each
   * opening a sheet with how it's made, rather than the canvas. On by default;
   * false keeps the canvas at every size.
   */
  phoneView?: boolean;
  /** Shows each target field's value for a sample input, updated as the map changes. */
  preview?: PreviewOptions;
  /** How far the grid starts zoomed, from 0.4 to 2. 1, full size, by default. */
  zoom?: number;
  /** Read-only: draws each target field's line straight from the source fields it comes from, without the operators between. */
  hideOperators?: boolean;
  /** Read-only: closes up the grid between the trees, leaving room for the lines. Hides operators and notes too. */
  hideGrid?: boolean;
  /** Hides the type badges beside field names. */
  hideTypes?: boolean;
  /** Hides notes. */
  hideNotes?: boolean;
  /** Hides the page tabs, and shows everything on every page together. */
  hidePages?: boolean;
  /** Hides the magnifier in each tree's heading that finds a field. */
  hideSearch?: boolean;
  /**
   * Lets people replace the source or target schema from each tree's heading:
   * with one made from a sample of the data, a JSON Schema, or one picked from
   * an OpenAPI document. Off by default, for hosts that own their schemas.
   */
  editSchemas?: boolean;
  /** The editor's wording, to translate it or use your own terms. Anything left out stays in English. See `englishLabels`. */
  labels?: Partial<Labels>;
  /** Called when what's selected changes, with the new selection or `undefined`. */
  onSelectionChange?: (selection: MapperSelection | undefined) => void;
  /**
   * Called when the page shown changes, with its id, or `undefined` in a map
   * without pages, and the sub-map shown, if one is.
   */
  onPageChange?: (page: string | undefined, submap: string | undefined) => void;
  /** Called with every issue when the editor first shows the map, and whenever they change. */
  onIssuesChange?: (issues: MapIssue[]) => void;
  /**
   * Called with how long the editor took to draw: `render` after an edit, or
   * anything else that rebuilds it, and `redraw` each time its lines are drawn
   * again, such as while something's dragged, hovered or scrolled.
   */
  onPerformance?: (timing: { kind: "render" | "redraw"; ms: number }) => void;
}

export interface PreviewOptions {
  /** The sample input. Change it later with `setPreviewInput`. */
  input: JsonValue;
  /**
   * Runs the preview somewhere else, such as on your server with `previewOverHttp`.
   * Leave it out to run in the browser, which works unless the map uses operators
   * that only run on the server.
   */
  run?: PreviewRunner;
  /** How long to wait after an edit before running, in milliseconds. Defaults to 250. */
  delay?: number;
}

/** What's selected in the editor: one operator, several, a line, or a loop. A line is named by its place in the map's `links`. */
export type MapperSelection =
  | { kind: "operator"; id: string }
  | { kind: "operators"; ids: string[] }
  | { kind: "link"; index: number }
  | { kind: "loop"; target: string };

export interface Mapper {
  getDocument(): MapDocument;
  /** What's selected, if anything. */
  getSelection(): MapperSelection | undefined;
  /** Replaces the document without calling `onChange`. It can be undone. */
  setDocument(document: MapDocument): void;
  getIssues(): MapIssue[];
  setTheme(theme: string | ThemeDefinition): void;
  /** Changes the preview's sample input, or turns the preview off with `undefined`. */
  setPreviewInput(input: JsonValue | undefined): void;
  undo(): void;
  redo(): void;
  destroy(): void;
}

type Selection =
  | { kind: "node"; id: string }
  | { kind: "nodes"; ids: string[] }
  | { kind: "link"; index: number }
  | { kind: "loop"; target: string }
  | undefined;

/** The map at one level of a document: the main map, or one of its sub-maps as a map of its own. */
function levelOf(document: MapDocument, name: string | undefined): MapDocument {
  const submap = name === undefined ? undefined : document.submaps?.[name];
  if (!submap) return document;
  const { title: _title, ...map } = submap;
  // A level can use the document's other sub-maps, so they come along.
  return { version: document.version, ...map, submaps: document.submaps! };
}

/** Puts a level, edited, back into the document. Sub-maps made or changed from it come too. */
function withLevel(document: MapDocument, name: string | undefined, level: MapDocument): MapDocument {
  if (name === undefined) return level;
  const { version: _version, submaps, ...map } = level;
  const title = document.submaps?.[name]?.title;
  return { ...document, submaps: { ...submaps, [name]: title === undefined ? map : { title, ...map } } };
}

/** Lookup tables are typed one `key = value` per line. */
const formatTable = (table: Record<string, JsonValue>) =>
  Object.entries(table)
    .map(([key, value]) => `${key} = ${formatConstant(value)}`)
    .join("\n");

function parseTable(text: string): Record<string, JsonValue> {
  const table: Record<string, JsonValue> = {};
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const split = line.indexOf("=");
    if (split < 0) table[line.trim()] = "";
    else table[line.slice(0, split).trim()] = parseConstant(line.slice(split + 1).trim());
  }
  return table;
}

const isTable = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface Point {
  x: number;
  y: number;
}

const SVG = "http://www.w3.org/2000/svg";

/** Counts editors on the page, to give each one's element ids their own number. */
let editors = 0;

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: Child[]) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  for (const child of children) if (child) element.append(child);
  return element;
}

const TYPE_BADGES: Record<NonNullable<Schema["type"]>, string> = {
  string: "abc",
  number: "1.2",
  integer: "123",
  boolean: "y/n",
  null: "null",
  object: "{ }",
  array: "[ ]",
};

/** The SVG path of a link from `a` to `b` in a theme's link style. */
function linkPath(style: LinkStyle, a: Point, b: Point): string {
  if (style === "straight") return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  if (style === "elbow") {
    // Across, down at the midpoint, across again, with rounded corners.
    const middle = (a.x + b.x) / 2;
    const dy = b.y - a.y;
    const r = Math.min(8, Math.abs(dy) / 2, Math.abs(b.x - a.x) / 2);
    if (r < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    const down = Math.sign(dy);
    const across = Math.sign(b.x - a.x) || 1;
    return [
      `M ${a.x} ${a.y}`,
      `L ${middle - r * across} ${a.y}`,
      `Q ${middle} ${a.y} ${middle} ${a.y + r * down}`,
      `L ${middle} ${b.y - r * down}`,
      `Q ${middle} ${b.y} ${middle + r * across} ${b.y}`,
      `L ${b.x} ${b.y}`,
    ].join(" ");
  }
  const bend = Math.max(24, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + bend} ${a.y}, ${b.x - bend} ${b.y}, ${b.x} ${b.y}`;
}

/** A point a fraction `t` of the way along a link drawn by `linkPath`. */
function pointOnLink(style: LinkStyle, a: Point, b: Point, t: number): Point {
  if (style === "elbow") {
    // On the last stretch, after the bend, where the line runs level into `b`.
    const middle = (a.x + b.x) / 2;
    return { x: middle + (b.x - middle) * (2 * t - 1), y: b.y };
  }
  if (style === "straight") return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const bend = Math.max(24, Math.abs(b.x - a.x) * 0.45);
  const [p1, p2] = [{ x: a.x + bend, y: a.y }, { x: b.x - bend, y: b.y }];
  const u = 1 - t;
  const along = (p0: number, q1: number, q2: number, p3: number) => u * u * u * p0 + 3 * u * u * t * q1 + 3 * u * t * t * q2 + t * t * t * p3;
  return { x: along(a.x, p1.x, p2.x, b.x), y: along(a.y, p1.y, p2.y, b.y) };
}

const typeBadge = (schema: Schema, repeating: boolean) => (repeating ? "[ ]" : TYPE_BADGES[schema.type ?? "object"]);

const glyphOf = (definition: OperatorDefinition | undefined) => definition?.glyph ?? definition?.label.slice(0, 2) ?? "?";

/**
 * Mounts the mapping editor in `element`: the source tree, the grid of
 * operators and the target tree, with the links between them.
 */
export function createMapper(element: HTMLElement, options: MapperOptions): Mapper {
  injectStyles(element.ownerDocument);
  const registry = options.registry ?? createRegistry();
  // The whole document, the level being shown (the main map, or a sub-map by name), and that level as a map.
  let doc = structuredClone(options.document);
  let level: string | undefined;
  let map = doc;
  // The page of the map being shown, by id. Undefined, or gone, means the first.
  let page: string | undefined;
  let issues: MapIssue[] = [];
  let selection: Selection;
  let theme: ResolvedTheme = resolveTheme(options.theme ?? "ink");
  const t: Labels = { ...englishLabels, ...options.labels };
  /** An operator's name, description and input labels, in the host's words. */
  const operatorText = (definition: OperatorDefinition | undefined, fallback: string) => (definition ? t.operator(definition) : { label: fallback });
  /** An operator's width and height on the grid, which the theme's density sets. */
  const nodeSize = () => densities[theme.density].node;
  const applyTheme = () => {
    injectStyle(element.ownerDocument, `crosswalk-theme-${theme.id}`, themeStyles(theme));
    root.dataset.cwTheme = theme.id;
  };
  const undoStack: { doc: MapDocument; level: string | undefined }[] = [];
  const redoStack: { doc: MapDocument; level: string | undefined }[] = [];

  const sourceTree = h("div", { class: "cw-tree cw-source" });
  const targetTree = h("div", { class: "cw-tree cw-target" });
  const surface = h("div", { class: "cw-surface" });
  const readOnly = options.readOnly ?? false;
  // Hiding operators only makes sense where nobody needs to edit them.
  const hideGrid = readOnly && (options.hideGrid ?? false);
  const hideOperators = hideGrid || (readOnly && (options.hideOperators ?? false));
  // With operators hidden there's nothing to split, so no pages either.
  const showPages = !hideOperators && !(options.hidePages ?? false);
  const empty = h(
    "div",
    { class: "cw-empty" },
    readOnly
      ? h("div", {}, t.emptyReadOnly)
      : h("div", {}, t.emptyHint[0], h("br"), t.emptyHint[1]),
  );
  // The surface is drawn at the zoom with a CSS scale; the sizer around it takes up the zoomed size, so scrolling covers it.
  const sizer = h("div", { class: "cw-surface-size" }, surface);
  const viewport = h("div", { class: "cw-viewport" }, empty, sizer);
  let zoom = 1;
  let surfaceSize = { width: 0, height: 0 };
  const svg = document.createElementNS(SVG, "svg");
  svg.classList.add("cw-links");
  const inspector = h("div", { class: "cw-inspector" });
  const previewStatus = h("div", { class: "cw-preview-status", role: "status" });
  previewStatus.hidden = true;
  const zoomButton = (label: string, icon: string, onClick: () => void) => {
    const button = h("button", { class: "cw-zoom-button", type: "button", title: label, "aria-label": label }, icon);
    button.addEventListener("click", onClick);
    return button;
  };
  const zoomLabel = h("button", { class: "cw-zoom-label", type: "button", title: t.zoomReset }, "100%");
  zoomLabel.addEventListener("click", () => setZoom(1));
  const zoomBar = h(
    "div",
    { class: "cw-zoom" },
    zoomButton(t.zoomOut, "−", () => setZoom(zoom / 1.2)),
    zoomLabel,
    zoomButton(t.zoomIn, "+", () => setZoom(zoom * 1.2)),
    zoomButton(t.fitInView, "⤢", () => fitToView()),
  );
  zoomBar.hidden = options.fitContent ?? false;
  const pageBar = h("div", { class: "cw-pages", role: "tablist", "aria-label": t.pages });
  const grid = h("div", { class: "cw-grid" }, viewport, svg, inspector, previewStatus, zoomBar, pageBar);
  const toolbox = h("div", { class: "cw-toolbox" });
  const bar = h("div", { class: "cw-bar" });
  const root = h(
    "div",
    {
      class: ["cw-root", readOnly && "cw-readonly", hideGrid && "cw-no-grid", options.hideTypes && "cw-no-types", options.fitContent && "cw-fit"].filter(Boolean).join(" "),
      tabindex: "0",
    },
    bar,
    h("div", { class: "cw-body" }, !readOnly && toolbox, sourceTree, grid, targetTree),
  );
  applyTheme();
  element.append(root);

  const sourceRows = new Map<string, HTMLElement>();
  const targetRows = new Map<string, HTMLElement>();
  const nodeElements = new Map<string, HTMLElement>();
  const noteElements = new Map<string, HTMLElement>();
  let renderedSchemas = "";

  // ---- toolbox ----

  const toggle = h("button", { class: "cw-icon-button cw-toolbox-toggle", type: "button" });
  const search = h("input", { class: "cw-toolbox-search", type: "search", placeholder: t.findOperator, "aria-label": t.findOperator });
  const sections = h("div", { class: "cw-toolbox-list" });
  toolbox.append(
    h("div", { class: "cw-toolbox-head" }, h("span", { class: "cw-toolbox-title" }, t.operators), toggle),
    h("span", { class: "cw-toolbox-rail", "aria-hidden": "true" }, t.operators),
    search,
    sections,
    h("p", { class: "cw-hint" }, t.toolboxHint),
  );

  const categoryColours: string[] = [];
  for (const category of registry.categories()) {
    const operators = registry.list().filter((operator) => operator.category === category.id);
    // A category's own colour applies where the theme doesn't set one.
    if (category.color) categoryColours.push(`.cw-root .cw-cat-${category.id} { --cw-node: ${category.color}; }`);
    const chips = operators.map((operator) => {
      const chip = h(
        "div",
        { class: `cw-chip cw-cat-${category.id}`, "data-operator": operator.id, title: t.addOperatorHint(t.operator(operator).label) },
        glyphOf(operator),
      );
      chip.dataset.search = `${t.operator(operator).label} ${operator.label} ${operator.id} ${t.category(category)}`.toLowerCase();
      return chip;
    });
    sections.append(h("div", { class: "cw-section" }, h("h4", { class: "cw-group" }, t.category(category)), h("div", { class: "cw-chips" }, ...chips)));
  }
  if (categoryColours.length > 0) root.append(h("style", {}, categoryColours.join("\n")));
  const noteChip = h("div", { class: "cw-chip cw-note-chip", "data-note-chip": "", title: t.noteChip }, "✎");
  noteChip.dataset.search = "note comment";
  sections.append(h("div", { class: "cw-section" }, h("h4", { class: "cw-group" }, t.notes), h("div", { class: "cw-chips" }, noteChip)));

  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    for (const section of sections.children) {
      let shown = 0;
      for (const chip of section.querySelectorAll<HTMLElement>(".cw-chip")) {
        chip.hidden = query !== "" && !chip.dataset.search?.includes(query);
        if (!chip.hidden) shown++;
      }
      (section as HTMLElement).hidden = shown === 0;
    }
  });

  const setToolboxCollapsed = (collapsed: boolean) => {
    toolbox.classList.toggle("cw-collapsed", collapsed);
    const label = collapsed ? t.showOperators : t.hideOperators;
    toggle.textContent = collapsed ? "»" : "«";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  // Left to itself, the toolbox folds to its rail in a narrow editor, until someone opens or closes it.
  let toolboxChosen = options.toolboxCollapsed !== undefined;
  const NARROW = 720;
  /** How far a finger can move, in pixels, and still be a tap or a press, and how long it's held for a press. */
  const TOUCH_SLOP = 8;
  /** Narrower than this, in pixels, and the editor lays itself out for a phone. */
  const COMPACT = 560;
  const TOUCH_HOLD_MS = 350;
  setToolboxCollapsed(options.toolboxCollapsed ?? false);
  toggle.addEventListener("click", () => {
    const collapsed = !toolbox.classList.contains("cw-collapsed");
    toolboxChosen = true;
    setToolboxCollapsed(collapsed);
    options.onToolboxToggle?.(collapsed, false);
  });

  // ---- rendering ----

  /** The source and target paths with a line to or from them: links, loops and aggregate scopes. */
  const mappedPaths = () => {
    const source = new Set<string>();
    const target = new Set<string>();
    for (const link of map.links) {
      if ("source" in link.from) source.add(link.from.source);
      if ("target" in link.to) target.add(link.to.target);
    }
    for (const loop of map.loops ?? []) {
      source.add(loop.source);
      target.add(loop.target);
    }
    for (const node of map.nodes) if (node.scope) source.add(node.scope);
    // A record link's fields count too, so the read-only view shows what it maps.
    for (const link of map.links) {
      for (const mapping of recordMappings(map, link)) {
        source.add(mapping.source);
        target.add(mapping.target);
      }
    }
    return { source, target };
  };

  // Records folded away in each tree, by level, so a sub-map keeps its own.
  const folds = new Map<string, Set<string>>();
  const foldsFor = (side: "source" | "target") => {
    const key = `${level ?? ""}\n${side}`;
    if (!folds.has(key)) folds.set(key, new Set());
    return folds.get(key)!;
  };
  /** The outermost folded record a field is inside, if any. */
  const foldedAbove = (side: "source" | "target", path: string) =>
    [...foldsFor(side)].filter((record) => path.startsWith(`${record}.`)).sort((a, b) => a.length - b.length)[0];

  // What each tree is being searched for, in lower case. Empty when it isn't.
  const searches = { source: "", target: "" };

  /**
   * Hides the fields inside folded records, and points each record's arrow the
   * right way. While a tree is searched, it shows the fields that match instead,
   * with the records they're in and what's inside a record that matches, folded
   * or not, and marks the matching text.
   */
  const applyFolds = (side: "source" | "target") => {
    const rows = side === "source" ? sourceRows : targetRows;
    const folded = foldsFor(side);
    const query = searches[side];
    const matches = (path: string) => {
      const name = rows.get(path)?.dataset.name ?? "";
      return name.toLowerCase().includes(query) || path.toLowerCase().includes(query);
    };
    const matched = query === "" ? [] : [...rows.keys()].filter(matches);
    // While the other tree is searched, this one keeps only the fields its paths reach, and the records they're in.
    const reach = searchChains()[side === "source" ? "target" : "source"];
    const reached = reach && (side === "source" ? reach.sources : reach.targets);
    const holders = reached && new Set([...reached].flatMap((path) => [...path.matchAll(/\./g)].map((m) => path.slice(0, m.index))));
    let showing = 0;
    for (const [path, row] of rows) {
      row.hidden =
        (query === ""
          ? foldedAbove(side, path) !== undefined && !reached
          : !matched.some((m) => m === path || m.startsWith(`${path}.`) || path.startsWith(`${m}.`))) ||
        (reached !== undefined && !reached.has(path) && !holders!.has(path));
      if (!row.hidden) showing++;
      row.querySelector(".cw-twisty")?.setAttribute("aria-expanded", String(query !== "" || !folded.has(path)));
      const name = row.querySelector(".cw-name")!;
      const text = row.dataset.name ?? "";
      const at = query === "" ? -1 : text.toLowerCase().indexOf(query);
      name.replaceChildren(
        ...(at === -1 ? [text] : [text.slice(0, at), h("mark", { class: "cw-match" }, text.slice(at, at + query.length)), text.slice(at + query.length)]),
      );
    }
    const pane = side === "source" ? sourceTree : targetTree;
    const none = pane.querySelector<HTMLElement>(".cw-no-match");
    if (none) none.hidden = (query === "" && !reached) || showing > 0;
  };

  /**
   * In place of a tree, a form to replace its schema: from a sample of the
   * data, a JSON Schema, or one of the schemas an OpenAPI document describes.
   * It's an edit like any other, so undo puts the old schema back.
   */
  function openSchemaForm(side: "source" | "target") {
    const pane = side === "source" ? sourceTree : targetTree;
    let kind: "sample" | "schema" | "openapi" | "xml" | "xsd" | "csv" = "sample";
    const text = h("textarea", { class: "cw-schema-text", rows: "10", spellcheck: "false" });
    const pick = h("select", { class: "cw-schema-pick", "aria-label": t.whichSchema });
    const problem = h("p", { class: "cw-schema-problem", role: "alert" });
    // The schemas an OpenAPI document or an XSD offers, to pick from.
    const found = (): { name: string; schema: Schema }[] => {
      try {
        return kind === "xsd" ? xsdSchemas(text.value) : openApiSchemas(JSON.parse(text.value));
      } catch {
        return [];
      }
    };
    const picking = () => kind === "openapi" || kind === "xsd";
    const update = () => {
      text.placeholder = t.pasteHere(kind);
      text.setAttribute("aria-label", t.pasteHere(kind));
      pick.hidden = !picking();
      if (picking()) pick.replaceChildren(...found().map((schema) => new Option(schema.name, schema.name)));
      for (const button of kinds.querySelectorAll<HTMLElement>("[data-kind]")) button.setAttribute("aria-checked", String(button.dataset.kind === kind));
    };
    const kinds = h(
      "div",
      { class: "cw-schema-kinds", role: "radiogroup" },
      ...([
        ["sample", t.fromSample],
        ["schema", t.fromJsonSchema],
        ["openapi", t.fromOpenApi],
        ["xml", t.fromXmlSample],
        ["xsd", t.fromXsd],
        ["csv", t.fromCsvSample],
      ] as const).map(([value, name]) => {
        const button = h("button", { type: "button", role: "radio", "data-kind": value }, name);
        button.addEventListener("click", () => {
          kind = value;
          problem.textContent = "";
          update();
        });
        return button;
      }),
    );
    text.addEventListener("input", () => picking() && update());
    const use = textButton(t.useSchema, () => {
      let json: unknown;
      if (kind !== "xml" && kind !== "xsd" && kind !== "csv") {
        try {
          json = JSON.parse(text.value);
        } catch (error) {
          problem.textContent = t.notJson((error as Error).message);
          return;
        }
      }
      try {
        const chosen = () => found().find((s) => s.name === pick.value)?.schema;
        const schema: Schema =
          kind === "sample"
            ? inferSchema(json as JsonValue)
            : kind === "schema"
              ? (json as Schema)
              : kind === "xml"
                ? inferXmlSchema(text.value)
                : kind === "csv"
                  ? inferCsvSchema(text.value)
                : (chosen() ??
                  (() => {
                    // Parse again, so a broken document says what's wrong with it.
                    if (kind === "xsd") xsdSchemas(text.value);
                    throw new Error(kind === "xsd" ? t.noElementsInXsd : t.noSchemasInOpenApi);
                  })());
        if (resolveSchema(schema).type !== "object") throw new Error(t.notRecord);
        // The form goes when the tree comes back; the editor keeps the keyboard, for undo.
        root.focus({ preventScroll: true });
        commit(edits.setSchema(map, side, schema));
      } catch (error) {
        problem.textContent = (error as Error).message;
      }
    });
    const cancel = textButton(t.cancel, () => {
      root.focus({ preventScroll: true });
      renderedSchemas = "";
      refresh();
    });
    update();
    pane.scrollTop = 0;
    pane.replaceChildren(h("div", { class: "cw-schema-form" }, h("div", { class: "cw-tree-title" }, h("span", { class: "cw-tree-kind" }, side), t.replaceSchema(side)), kinds, text, pick, problem, h("div", { class: "cw-schema-actions" }, use, cancel)));
    text.focus();
  }

  /** Searches a tree's fields as the text in its search box changes. */
  const searchTree = (side: "source" | "target", text: string) => {
    searches[side] = text.trim().toLowerCase();
    applyFolds("source");
    applyFolds("target");
    // The narrowed trees start from the top.
    sourceTree.scrollTop = 0;
    targetTree.scrollTop = 0;
    arrange();
    fitHeight();
    scheduleDraw();
  };

  /**
   * Places the operators: laid out between their fields while a search is
   * under way, or with auto layout on; otherwise where they were saved. The
   * search's own layout isn't saved, so clearing it puts them back.
   */
  function arrange() {
    layout = options.autoLayout || searching() ? computeLayout() : undefined;
    map.nodes.forEach((node, index) => {
      const element = nodeElements.get(node.id);
      if (!element) return;
      const position = layout?.get(node.id) ?? node.position ?? autoPosition(index);
      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
    });
    if (searching()) viewport.scrollTo(0, 0);
  }

  const toggleFold = (side: "source" | "target", path: string) => {
    const folded = foldsFor(side);
    if (!folded.delete(path)) folded.add(path);
    applyFolds(side);
    fitHeight();
    scheduleDraw();
  };

  const renderTree = (pane: HTMLElement, schema: Schema, side: "source" | "target") => {
    const rows = side === "source" ? sourceRows : targetRows;
    const mapped = options.mappedOnly ? mappedPaths()[side] : undefined;
    // A field shows when it's mapped, or holds one that is.
    const shows = (path: string) => !mapped || [...mapped].some((m) => m === path || m.startsWith(`${path}.`));
    rows.clear();
    const name = schema.title ?? (side === "source" ? t.input : t.output);
    const label = h("span", { class: "cw-tree-name" }, name);
    const search = h("input", { class: "cw-tree-search", type: "search", placeholder: t.findField(side), "aria-label": t.findField(side) });
    const open = h("button", { class: "cw-tree-find", type: "button", title: t.findField(side), "aria-label": t.findField(side) });
    open.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    const editable = options.editSchemas === true && !readOnly;
    const replace = h("button", { class: "cw-tree-replace", type: "button", title: t.replaceSchema(side), "aria-label": t.replaceSchema(side) });
    replace.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 4h8l-2-2M13 12H5l2 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    replace.addEventListener("click", () => openSchemaForm(side));
    const title = h(
      "div",
      { class: `cw-tree-title${options.hideSearch ? "" : " cw-findable"}${editable ? " cw-editable" : ""}` },
      h("span", { class: "cw-tree-kind" }, side),
      label,
      ...(options.hideSearch ? [] : [search, open]),
      ...(editable ? [replace] : []),
    );
    // The box takes the title's place while there's something in it.
    const searching = (on: boolean) => title.classList.toggle("cw-searching", on);
    search.value = searches[side];
    searching(searches[side] !== "");
    open.addEventListener("click", () => {
      searching(true);
      search.focus();
    });
    search.addEventListener("input", () => searchTree(side, search.value));
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      search.value = "";
      searchTree(side, "");
      searching(false);
      open.focus();
    });
    search.addEventListener("blur", () => {
      if (search.value.trim() === "") searching(false);
    });
    const list = h("div", { class: "cw-rows" });
    const fields = listFields(schema).filter((field) => shows(field.path));
    for (const [index, field] of fields.entries()) {
      const value = isValueSchema(field.schema);
      // A record or list with fields shown under it can fold them away.
      const holds = fields[index + 1]?.path.startsWith(`${field.path}.`) ?? false;
      const twisty = holds ? h("button", { type: "button", class: "cw-twisty", "aria-expanded": "true", "aria-label": t.fold(field.name), title: t.foldOrUnfold }) : h("span", { class: "cw-twisty-space" });
      if (holds) twisty.addEventListener("click", () => toggleFold(side, field.path));
      const row = h(
        "div",
        { class: `cw-row${!value && !field.repeating ? " cw-record" : ""}`, "data-path": field.path, title: field.path },
        twisty,
        h("span", { class: "cw-type", title: field.repeating ? t.repeating : (field.schema.type ?? "object") }, typeBadge(field.schema, field.repeating)),
        h("span", { class: "cw-name" }, field.name),
        side === "target" && field.required && h("span", { class: "cw-required", title: t.required }, "*"),
        side === "target" && h("span", { class: "cw-sample" }),
        h("span", { class: "cw-stub" }),
      );
      row.dataset.name = field.name;
      row.dataset.repeating = String(field.repeating);
      row.dataset.value = String(value);
      if (side === "target") row.dataset.drop = "target";
      row.style[side === "source" ? "paddingLeft" : "paddingRight"] = `${10 + field.depth * 14}px`;
      rows.set(field.path, row);
      list.append(row);
    }
    const none = h("p", { class: "cw-no-match" }, t.noFieldsMatch);
    pane.replaceChildren(title, list, none);
    applyFolds(side);
    if (side === "target") applySamples();
  };

  // ---- pages ----

  const pages = () => map.pages ?? [];
  const activePage = () => (pages().some((p) => p.id === page) ? page : pages()[0]?.id);
  /** True for what's on the page being shown. In a map without pages, everything is; so it is with pages hidden. */
  const onPage = (item: { page?: string }) => !showPages || edits.pageOf(map, item) === activePage();
  const pageNodes = () => map.nodes.filter(onPage);
  /** A note on an operator is on that operator's page. */
  const noteOnPage = (note: Note) => {
    const on = note.on;
    if (on && "node" in on) {
      const node = map.nodes.find((n) => n.id === on.node);
      if (node) return onPage(node);
    }
    return onPage(note);
  };
  const pageName = (id: string | undefined) => pages().find((p) => p.id === id)?.name ?? t.anotherPage;
  /** Puts what's just been added on the page being shown. */
  const onActivePage = (next: MapDocument, ids: readonly string[]) => {
    const current = activePage();
    return current === undefined ? next : edits.moveToPage(next, ids, current);
  };

  function showPage(id: string | undefined) {
    if (id === activePage()) return;
    page = id;
    selection = undefined;
    refresh();
    revealPage();
    if (traced) showChain(chainOf(traced));
  }

  /** A tab being renamed, by page id, so the strip draws a text box for it. */
  let renaming: string | undefined;

  /** The page tabs along the bottom of the grid. A map without pages has the one tab, and a button to add another. */
  function renderPages() {
    pageBar.hidden = !showPages || (readOnly && pages().length < 2);
    if (pageBar.hidden) return pageBar.replaceChildren();
    const shown = pages().length > 0 ? pages() : [{ id: "", name: t.firstPage }];
    const current = activePage() ?? "";
    const failing = new Set(
      issues.filter((i) => i.severity === "error" && i.node !== undefined && i.submap === undefined).flatMap((i) => {
        const node = map.nodes.find((n) => n.id === i.node);
        return node ? [edits.pageOf(map, node) ?? ""] : [];
      }),
    );
    // While a field is traced, each page shows how many of its chain's operators it holds.
    const traceCounts = new Map<string, number>();
    if (traced) {
      const chain = chainOf(traced);
      for (const node of map.nodes) {
        if (!chain.nodes.has(node.id)) continue;
        const where = edits.pageOf(map, node) ?? "";
        traceCounts.set(where, (traceCounts.get(where) ?? 0) + 1);
      }
    }
    const tabs = shown.map(({ id, name }) => {
      if (renaming === id) {
        const input = h("input", { class: "cw-page-name", "aria-label": t.pageName, value: name });
        let done = false;
        const finish = (save: boolean) => {
          if (done) return;
          done = true;
          renaming = undefined;
          const text = input.value.trim();
          if (!save || text === "" || text === name) return renderPages();
          // The one tab of a map without pages becomes its first page.
          commit(id === "" ? { ...structuredClone(map), pages: [{ id: "page1", name: text }] } : edits.renamePage(map, id, text));
        };
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") finish(true);
          else if (event.key === "Escape") finish(false);
          event.stopPropagation();
        });
        input.addEventListener("blur", () => finish(true));
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
        return input;
      }
      const tab = h(
        "button",
        { class: "cw-page-tab", type: "button", role: "tab", "data-page": id, title: readOnly ? name : t.renamePage(name) },
        h("span", { class: "cw-page-label" }, name),
      );
      tab.setAttribute("aria-selected", String(id === current));
      const traceCount = traceCounts.get(id);
      if (traceCount) {
        tab.append(h("span", { class: "cw-page-count", title: t.tracedOperators(traceCount) }, String(traceCount)));
      }
      if (failing.has(id)) tab.classList.add("cw-error");
      tab.addEventListener("click", () => showPage(id === "" ? undefined : id));
      if (!readOnly) {
        tab.addEventListener("dblclick", () => {
          renaming = id;
          renderPages();
        });
        if (id === current && shown.length > 1) {
          const remove = h("span", { class: "cw-page-remove", role: "button", title: t.deletePageHint(name), "aria-label": t.deletePage(name) }, "✕");
          remove.addEventListener("click", (event) => {
            event.stopPropagation();
            commit(edits.removePage(map, id));
          });
          tab.append(remove);
        }
      }
      return tab;
    });
    const add =
      !readOnly &&
      h("button", { class: "cw-page-tab cw-page-add", type: "button", "data-page": "new", title: t.addPageHint, "aria-label": t.addPage }, "+");
    add && add.addEventListener("click", () => addPageWith());
    // The add button first, so it's never scrolled out of reach.
    // Every page, for when the tabs don't all fit: a list over a button at the bar's end.
    const list = h("select", { class: "cw-page-list", "aria-label": t.goToPage, title: t.allPages });
    for (const { id, name } of shown) list.append(new Option(name, id, false, id === current));
    list.addEventListener("change", () => showPage(list.value === "" ? undefined : list.value));
    const menu = h("span", { class: "cw-page-menu" }, list);
    pageBar.replaceChildren(...(add ? [add] : []), ...tabs, menu);
    fitPages();
  }

  /** Shows the list of every page when the tabs don't fit, and scrolls the open tab into view. */
  function fitPages() {
    const menu = pageBar.querySelector<HTMLElement>(".cw-page-menu");
    if (pageBar.hidden || !menu) return;
    menu.hidden = true;
    menu.hidden = pageBar.scrollWidth <= pageBar.clientWidth + 1;
    const open = pageBar.querySelector<HTMLElement>('.cw-page-tab[aria-selected="true"]');
    if (!open) return;
    // The ends are taken by + and the list, which stay put as the tabs scroll.
    const before = pageBar.querySelector<HTMLElement>(".cw-page-add")?.offsetWidth ?? 0;
    const after = menu.hidden ? 0 : menu.offsetWidth;
    if (open.offsetLeft - before < pageBar.scrollLeft) pageBar.scrollLeft = open.offsetLeft - before;
    else if (open.offsetLeft + open.offsetWidth + after > pageBar.scrollLeft + pageBar.clientWidth) {
      pageBar.scrollLeft = open.offsetLeft + open.offsetWidth + after - pageBar.clientWidth;
    }
  }

  /** Moves something onto a page. */
  type PageMove = (document: MapDocument, page: string) => MapDocument;
  const movingIds = (ids: readonly string[]): PageMove => (document, id) => edits.moveToPage(document, ids, id);

  /** Adds a page, with what `move` moves put on it, and shows it. */
  function addPageWith(move?: PageMove) {
    const added = edits.addPage(map);
    page = added.id;
    selection = undefined;
    commit(move ? move(added.document, added.id) : added.document);
    revealPage();
  }

  /** The page tab under the pointer, while something's dragged over the strip: a page's id, or "new". */
  const pageTabAt = (event: PointerEvent) => {
    // Asking what's under the pointer is slow in a big map, so only over the tabs.
    if (pageBar.hidden) return undefined;
    const bar = pageBar.getBoundingClientRect();
    if (event.clientX < bar.left || event.clientX > bar.right || event.clientY < bar.top || event.clientY > bar.bottom) return undefined;
    return document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element) => element instanceof HTMLElement && element.dataset.page !== undefined && pageBar.contains(element)) as HTMLElement | undefined;
  };

  let pageDropTarget: HTMLElement | undefined;
  const showPageDrop = (event: PointerEvent) => {
    const tab = pageTabAt(event);
    const next = tab && tab.dataset.page !== "" && tab.dataset.page !== activePage() ? tab : undefined;
    if (next === pageDropTarget) return next;
    pageDropTarget?.classList.remove("cw-drop-ok");
    pageDropTarget = next;
    pageDropTarget?.classList.add("cw-drop-ok");
    return next;
  };
  /** Moves what was dragged onto the page tab it was dropped on. True if it went to another page. */
  const dropOnPage = (event: PointerEvent, move: PageMove): boolean => {
    const tab = showPageDrop(event);
    pageDropTarget?.classList.remove("cw-drop-ok");
    pageDropTarget = undefined;
    const id = tab?.dataset.page;
    if (id === undefined) return false;
    if (id === "new") addPageWith(move);
    else commit(move(map, id));
    return true;
  };

  const autoPosition = (index: number): Position => ({ x: 40 + (index % 6) * 70, y: 40 + Math.floor(index / 6) * 70 });

  let layout: Map<string, Position> | undefined;

  /**
   * Places each operator in a column by how many operators feed it, at the
   * height of the fields and operators it connects, then spaces out each
   * column so none overlap.
   */
  const computeLayout = (): Map<string, Position> => {
    const frame = grid.getBoundingClientRect();
    const rowY = (side: "source" | "target", path: string) => {
      const row = (side === "source" ? sourceRows : targetRows).get(path);
      if (!row || row.hidden) return undefined;
      const rect = row.getBoundingClientRect();
      return rect.top + rect.height / 2 - frame.top + viewport.scrollTop;
    };
    // While searching, only the operators on its paths.
    const laid = pageNodes().filter((node) => !searching() || inSearch(node.id));
    const ids = laid.map((node) => node.id);
    const inputs = new Map(ids.map((id) => [id, [] as LinkSource[]]));
    const outputs = new Map(ids.map((id) => [id, [] as LinkTarget[]]));
    for (const link of map.links) {
      if ("node" in link.to) inputs.get(link.to.node)?.push(link.from);
      if ("node" in link.from) outputs.get(link.from.node)?.push(link.to);
    }

    const depths = new Map<string, number>();
    const depthOf = (id: string, seen = new Set<string>()): number => {
      const known = depths.get(id);
      if (known !== undefined) return known;
      if (seen.has(id)) return 1;
      seen.add(id);
      const upstream = (inputs.get(id) ?? []).filter((from): from is { node: string } => "node" in from);
      const depth = 1 + Math.max(0, ...upstream.map((from) => depthOf(from.node, seen)));
      depths.set(id, depth);
      return depth;
    };

    // Start each operator level with the fields it touches, then let it settle
    // towards the middle of everything it connects.
    const fixed = new Map<string, number[]>();
    for (const node of laid) {
      const ys = [
        ...(inputs.get(node.id) ?? []).map((from) => ("source" in from ? rowY("source", from.source) : undefined)),
        ...(outputs.get(node.id) ?? []).map((to) => ("target" in to ? rowY("target", to.target) : undefined)),
        node.scope ? rowY("source", node.scope) : undefined,
      ].filter((y): y is number => y !== undefined);
      fixed.set(node.id, ys);
    }
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
    const y = new Map(ids.map((id) => [id, fixed.get(id)!.length > 0 ? mean(fixed.get(id)!) : 60]));
    for (let pass = 0; pass < 8; pass++) {
      for (const id of ids) {
        const neighbours = [
          ...fixed.get(id)!,
          ...(inputs.get(id) ?? []).flatMap((from) => ("node" in from && y.has(from.node) ? [y.get(from.node)!] : [])),
          ...(outputs.get(id) ?? []).flatMap((to) => ("node" in to && y.has(to.node) ? [y.get(to.node)!] : [])),
        ];
        if (neighbours.length > 0) y.set(id, mean(neighbours));
      }
    }

    const columns = new Map<number, string[]>();
    for (const id of ids) columns.set(depthOf(id), [...(columns.get(depthOf(id)) ?? []), id]);
    const deepest = Math.max(1, ...columns.keys());
    const spacing = Math.min(150, Math.max(80, (grid.clientWidth - 80) / deepest));
    const start = (grid.clientWidth - spacing * (deepest - 1)) / 2;
    const positions = new Map<string, Position>();
    for (const [depth, column] of columns) {
      column.sort((a, b) => y.get(a)! - y.get(b)!);
      let previous = -Infinity;
      for (const id of column) {
        // Room for an operator and its caption between neighbours.
        const centre = Math.max(y.get(id)!, previous + 62);
        previous = centre;
        positions.set(id, { x: Math.max(16, start + (depth - 1) * spacing - nodeSize() / 2) / zoom, y: Math.max(8, centre - nodeSize() / 2) / zoom });
      }
    }
    return positions;
  };

  /** Sets the editor's height to fit the trees and operators. */
  const fitHeight = () => {
    if (!options.fitContent) return;
    // On a phone the list is shown instead, and it's as tall as it needs to be.
    if (root.classList.contains("cw-phone")) {
      root.style.minHeight = "0";
      root.style.height = "auto";
      return;
    }
    const nodesBottom = Math.max(0, ...[...nodeElements.values(), ...noteElements.values()].map((element) => (element.offsetTop + element.offsetHeight) * zoom + 36));
    // The trees' own contents, not their scroll height, which never drops below the current height.
    const treeHeight = (pane: HTMLElement) => [...pane.children].reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0);
    // An empty view keeps room for its "Nothing is mapped yet."
    const content = Math.max(treeHeight(sourceTree), treeHeight(targetTree), nodesBottom, empty.hidden ? 0 : 140);
    root.style.minHeight = "0";
    // Room below for the page tabs, if there are any.
    const tabs = pageBar.hidden ? 0 : 44;
    root.style.height = `${content + tabs + bar.offsetHeight + 2}px`;
  };

  /** True when what a note is on is drawn, so the note can sit beside it. */
  const anchorShown = (on: NoteAnchor | undefined) =>
    on !== undefined && ("node" in on ? nodeElements.has(on.node) : "target" in on ? targetRows.has(on.target) : sourceRows.has(on.source));

  /**
   * Laid out automatically, operators move away from where loose notes were
   * left, so those line up below them. Notes on something follow it instead.
   */
  const placeNotes = () => {
    if (!layout) return;
    const top = Math.max(8, ...[...layout.values()].map((p) => p.y + nodeSize() + 36));
    const loose = (map.notes ?? []).filter((note) => !anchorShown(note.on)).flatMap((note) => noteElements.get(note.id) ?? []);
    loose.forEach((element, index) => {
      element.style.left = `${16 + index * 186}px`;
      element.style.top = `${top}px`;
    });
  };

  /** Sizes and scales the surface for the zoom. A view sized to fit doesn't zoom. */
  function applyZoom() {
    if (options.fitContent) {
      for (const element of [sizer, surface]) {
        element.style.width = "100%";
        element.style.height = "100%";
      }
      return;
    }
    surface.style.width = `${surfaceSize.width}px`;
    surface.style.height = `${surfaceSize.height}px`;
    surface.style.transform = zoom === 1 ? "" : `scale(${zoom})`;
    sizer.style.width = `${surfaceSize.width * zoom}px`;
    sizer.style.height = `${surfaceSize.height * zoom}px`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  /**
   * Zooms out, if need be, and scrolls so every operator and note is in view.
   * It never zooms in past 100%.
   */
  function fitToView() {
    const elements = [...nodeElements.values(), ...noteElements.values()];
    if (elements.length === 0 || options.fitContent) return;
    // Captions hang below operators, so leave room for them.
    const left = Math.min(...elements.map((e) => e.offsetLeft));
    const top = Math.min(...elements.map((e) => e.offsetTop));
    const right = Math.max(...elements.map((e) => e.offsetLeft + Math.max(e.offsetWidth, 70)));
    const bottom = Math.max(...elements.map((e) => e.offsetTop + e.offsetHeight + 20));
    const margin = 16;
    const next = Math.min(1, (viewport.clientWidth - margin * 2) / (right - left), (viewport.clientHeight - margin * 2) / (bottom - top));
    setZoom(next, { x: 0, y: 0 });
    viewport.scrollLeft = Math.max(0, left * zoom - margin);
    viewport.scrollTop = Math.max(0, top * zoom - margin);
    scheduleDraw();
  }

  /** Zooms the grid, keeping the point at `anchor` (in the grid's own pixels) where it is. */
  function setZoom(next: number, anchor = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
    const clamped = Math.min(2, Math.max(0.4, Math.round(next * 100) / 100));
    if (clamped === zoom) return;
    const point = { x: (anchor.x + viewport.scrollLeft) / zoom, y: (anchor.y + viewport.scrollTop) / zoom };
    zoom = clamped;
    applyZoom();
    viewport.scrollLeft = point.x * zoom - anchor.x;
    viewport.scrollTop = point.y * zoom - anchor.y;
    scheduleDraw();
  }

  const renderNodes = () => {
    nodeElements.clear();
    const nodeIssues = new Map<string, MapIssue[]>();
    for (const issue of issues) {
      if (issue.node === undefined || issue.submap !== undefined) continue;
      nodeIssues.set(issue.node, [...(nodeIssues.get(issue.node) ?? []), issue]);
    }
    let width = 0;
    let height = 0;
    surface.replaceChildren(
      ...(hideOperators ? [] : map.nodes).flatMap((node, index) => {
        if (!onPage(node)) return [];
        const definition = registry.get(node.operator);
        const position = layout?.get(node.id) ?? node.position ?? autoPosition(index);
        const problems = nodeIssues.get(node.id) ?? [];
        const element = h(
          "div",
          {
            class: `cw-node cw-cat-${definition?.category ?? "unknown"}`,
            "data-id": node.id,
            "data-drop": "node",
            title: [`${operatorText(definition, node.operator).label} (${node.id})`, ...problems.map(t.issue)].join("\n"),
          },
          glyphOf(definition),
          h("span", { class: "cw-out", "data-out": node.id }),
          h("span", { class: "cw-caption" }, readOnly ? operatorText(definition, node.operator).label : node.id),
        );
        if (problems.some((p) => p.severity === "error")) element.classList.add("cw-error");
        element.style.left = `${position.x}px`;
        element.style.top = `${position.y}px`;
        width = Math.max(width, position.x);
        height = Math.max(height, position.y);
        nodeElements.set(node.id, element);
        return [element];
      }),
    );
    noteElements.clear();
    // A closed-up grid has no room for notes either.
    for (const note of options.hideNotes || hideGrid ? [] : (map.notes ?? [])) {
      if (!noteOnPage(note)) continue;
      const position = note.position;
      const text = h("textarea", { class: "cw-note-text", "aria-label": t.note, placeholder: t.writeNote, rows: "3" });
      text.value = note.text;
      text.readOnly = readOnly;
      text.addEventListener("change", () => commit(edits.setNoteText(map, note.id, text.value)));
      const element = h(
        "div",
        { class: `cw-note${note.on ? " cw-pinned" : ""}`, "data-note": note.id },
        !readOnly &&
          h(
            "div",
            { class: "cw-note-grip", title: t.noteGrip },
            note.on && h("span", { class: "cw-note-on", title: t.pinnedTo(describeAnchor(note.on)) }, describeAnchor(note.on)),
            note.on && iconButton(t.unpinFrom(describeAnchor(note.on)), () => unpin(note.id), "⊘"),
            iconButton(t.deleteNote, () => commit(edits.removeNote(map, note.id))),
          ),
        text,
      );
      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
      if (!note.on) {
        width = Math.max(width, position.x + 120);
        height = Math.max(height, position.y);
      }
      noteElements.set(note.id, element);
      surface.append(element);
    }
    placeNotes();
    // Straight away, rather than at the next redraw, so they don't start out somewhere else.
    placePinnedNotes(grid.getBoundingClientRect());
    // A sized-to-fit view has no room to scroll into.
    surfaceSize = { width: width + 400, height: height + 300 };
    applyZoom();
    empty.hidden = (map.nodes.length > 0 && !hideOperators) || map.links.length > 0 || (map.loops?.length ?? 0) > 0 || (map.notes?.length ?? 0) > 0;
  };

  const updateRows = () => {
    const linkedSources = new Set<string>();
    const linkedTargets = new Set<string>();
    for (const link of map.links) {
      if ("source" in link.from) linkedSources.add(link.from.source);
      if ("target" in link.to) linkedTargets.add(link.to.target);
    }
    for (const loop of map.loops ?? []) {
      linkedSources.add(loop.source);
      linkedTargets.add(loop.target);
    }
    for (const node of map.nodes) if (node.scope) linkedSources.add(node.scope);
    const errorPaths = new Set(issues.filter((i) => i.severity === "error" && i.path && i.submap === undefined).map((i) => i.path));
    // On a map split into pages, fields the page shown doesn't use fade, so its own stand out.
    const split = showPages && pages().length > 1;
    const used = split ? pageFields() : undefined;
    // The records a path is inside, outermost first.
    const above = (path: string) => [...path.matchAll(/\./g)].map((m) => path.slice(0, m.index));
    // A field is the page's own if it's used, holds something used, or is inside something used.
    const holders = used && { source: new Set([...used.source].flatMap(above)), target: new Set([...used.target].flatMap(above)) };
    const elsewhere = (side: "source" | "target", path: string) =>
      used !== undefined && !used[side].has(path) && !holders![side].has(path) && !above(path).some((record) => used[side].has(record));
    for (const [path, row] of sourceRows) {
      row.classList.toggle("cw-linked", linkedSources.has(path));
      row.classList.toggle("cw-elsewhere", elsewhere("source", path));
    }
    for (const [path, row] of targetRows) {
      row.classList.toggle("cw-linked", linkedTargets.has(path));
      row.classList.toggle("cw-error", errorPaths.has(path));
      row.classList.toggle("cw-elsewhere", elsewhere("target", path));
    }
  };

  /** The source and target fields the page shown uses: into and out of its operators, and its own lines straight across. */
  const pageFields = () => {
    const used = { source: new Set<string>(), target: new Set<string>() };
    const here = new Set(pageNodes().map((n) => n.id));
    for (const link of map.links) {
      const straight = "source" in link.from && "target" in link.to;
      if ("source" in link.from && (straight ? onPage(link) : "node" in link.to && here.has(link.to.node))) used.source.add(link.from.source);
      if ("target" in link.to && (straight ? onPage(link) : "node" in link.from && here.has(link.from.node))) used.target.add(link.to.target);
    }
    for (const loop of map.loops ?? []) {
      if (!onPage(loop)) continue;
      used.source.add(loop.source);
      used.target.add(loop.target);
    }
    for (const node of pageNodes()) if (node.scope) used.source.add(node.scope);
    return used;
  };

  /**
   * Scrolls each tree to the fields the operators in view use, unless one of
   * them is already showing, so scrolling the grid down a big map doesn't leave
   * its lines running to fields out of sight.
   */
  function followGrid() {
    const view = viewport.getBoundingClientRect();
    const showing = new Set(
      [...nodeElements]
        .filter(([, element]) => {
          const box = element.getBoundingClientRect();
          return box.bottom > view.top && box.top < view.bottom && box.right > view.left && box.left < view.right;
        })
        .map(([id]) => id),
    );
    if (showing.size === 0) return;
    const fields = { source: new Set<string>(), target: new Set<string>() };
    for (const link of map.links) {
      if ("source" in link.from && "node" in link.to && showing.has(link.to.node)) fields.source.add(link.from.source);
      if ("node" in link.from && "target" in link.to && showing.has(link.from.node)) fields.target.add(link.to.target);
    }
    for (const id of showing) {
      const scope = map.nodes.find((n) => n.id === id)?.scope;
      if (scope) fields.source.add(scope);
    }
    for (const side of ["source", "target"] as const) {
      const pane = side === "source" ? sourceTree : targetTree;
      const rows = [...(side === "source" ? sourceRows : targetRows)].filter(([path, row]) => fields[side].has(path) && !row.hidden).map(([, row]) => row);
      if (rows.length === 0) continue;
      const area = pane.getBoundingClientRect();
      const top = area.top + (pane.firstElementChild?.getBoundingClientRect().height ?? 0);
      const inSight = rows.filter((row) => {
        const box = row.getBoundingClientRect();
        return box.top >= top && box.bottom <= area.bottom;
      }).length;
      // Left alone while most of them show; otherwise the middle one of them goes to the middle of the tree.
      if (inSight * 2 >= rows.length) continue;
      const middle = rows[Math.floor(rows.length / 2)]!.getBoundingClientRect();
      pane.scrollTop = Math.max(0, pane.scrollTop + middle.top - (top + area.bottom) / 2);
    }
  }

  /** Scrolls each tree to the first field the page shown uses, so opening a page shows what it's about. */
  const revealPage = () => {
    if (!showPages || pages().length < 2) return;
    const used = pageFields();
    for (const side of ["source", "target"] as const) {
      const pane = side === "source" ? sourceTree : targetTree;
      const first = [...(side === "source" ? sourceRows : targetRows)].find(([path, row]) => !row.hidden && used[side].has(path))?.[1];
      if (!first) continue;
      const title = pane.firstElementChild?.getBoundingClientRect().height ?? 0;
      pane.scrollTop = Math.max(0, pane.scrollTop + first.getBoundingClientRect().top - pane.getBoundingClientRect().top - title - 8);
    }
    scheduleDraw();
  };

  /** In a phone-sized grid the operators can start out of sight, so it scrolls across to the first of them. */
  const revealOperators = () => {
    if (viewport.scrollLeft > 0) return;
    const lefts = [...nodeElements.values()].filter((element) => !element.hidden).map((element) => element.offsetLeft);
    if (lefts.length > 0) viewport.scrollLeft = Math.max(0, Math.min(...lefts) * zoom - 16);
  };

  // ---- links ----

  // While the lines are drawn, each row and operator is measured once, however many lines meet it.
  let measured: Map<Element, DOMRect> | undefined;
  const rectOf = (element: Element) => {
    if (!measured) return element.getBoundingClientRect();
    let rect = measured.get(element);
    if (!rect) measured.set(element, (rect = element.getBoundingClientRect()));
    return rect;
  };

  const rowAnchor = (side: "source" | "target", path: string, frame: DOMRect): Point | undefined => {
    // A field folded away draws its lines to the folded record it's inside. One a search leaves out has none.
    const row = (side === "source" ? sourceRows : targetRows).get((searches[side] === "" && foldedAbove(side, path)) || path);
    if (!row || row.hidden) return undefined;
    const pane = side === "source" ? sourceTree : targetTree;
    const rect = rectOf(row);
    const paneRect = rectOf(pane);
    const titleHeight = pane.firstElementChild ? rectOf(pane.firstElementChild).height : 0;
    // A row scrolled out of its tree pins its line to the pane's edge, and the line is faded.
    const centre = rect.top + rect.height / 2;
    const y = Math.min(Math.max(centre, paneRect.top + titleHeight), paneRect.bottom);
    const point = { x: side === "source" ? 0 : frame.width, y: y - frame.top };
    if (y !== centre) offscreen.add(point);
    return point;
  };

  /** Points pinned to a tree's edge because their field is scrolled out of view. */
  const offscreen = new WeakSet<Point>();

  const nodeAnchor = (id: string, side: "in" | "out", frame: DOMRect): Point | undefined => {
    const element = nodeElements.get(id);
    if (!element) return undefined;
    const rect = rectOf(element);
    return { x: (side === "in" ? rect.left : rect.right) - frame.left, y: rect.top + rect.height / 2 - frame.top };
  };

  const fromAnchor = (from: LinkSource, frame: DOMRect) =>
    "source" in from ? rowAnchor("source", from.source, frame) : nodeAnchor(from.node, "out", frame);

  let dragLine: { from: (frame: DOMRect) => Point | undefined; to: Point } | undefined;

  /** The field or operator whose lines are picked out. */
  type Focus = { kind: "node"; id: string } | { kind: "source" | "target"; path: string };
  let hovered: Focus | undefined;
  const focusKeyOf = (focus: Focus) => (focus.kind === "node" ? `node:${focus.id}` : `${focus.kind}:${focus.path}`);

  /** A field clicked to trace its chain: what its value is made from, or where it goes. It stays picked out across pages. */
  let traced: Focus | undefined;
  // The chain is worked out once per map and focus, not every frame.
  let chainCache: { map: MapDocument; key: string; chain: Chain } | undefined;
  const chainOf = (focus: Focus): Chain => {
    const key = focusKeyOf(focus);
    if (chainCache?.map !== map || chainCache.key !== key) chainCache = { map, key, chain: traceChain(map, focus) };
    return chainCache.chain;
  };

  /**
   * While a tree is searched, the paths from the fields that match: forward
   * from source fields, back from target fields. Lines off them aren't drawn.
   * A field inside a matching record counts as matching, as the tree shows it.
   */
  let searchCache: { map: MapDocument; key: string; chains: { source?: Chain; target?: Chain } } | undefined;
  const searchChains = (): { source?: Chain; target?: Chain } => {
    const key = `${searches.source}\n${searches.target}`;
    if (searchCache?.map === map && searchCache.key === key) return searchCache.chains;
    const chains: { source?: Chain; target?: Chain } = {};
    for (const side of ["source", "target"] as const) {
      const query = searches[side];
      if (query === "") continue;
      const rows = side === "source" ? sourceRows : targetRows;
      const hits = [...rows].filter(([path, row]) => (row.dataset.name ?? "").toLowerCase().includes(query) || path.toLowerCase().includes(query)).map(([path]) => path);
      const matched = [...rows.keys()].filter((path) => hits.some((hit) => path === hit || path.startsWith(`${hit}.`)));
      chains[side] = traceFields(map, side, matched);
    }
    searchCache = { map, key, chains };
    return chains;
  };
  const searching = () => searches.source !== "" || searches.target !== "";
  /** True for an operator on the paths of every search under way, so it's shown. */
  const inSearch = (id: string) => Object.values(searchChains()).every((chain) => chain.nodes.has(id));

  /** Traces a field's chain, or stops tracing it if it's the one traced. */
  function traceField(field: Focus) {
    const same = traced !== undefined && focusKeyOf(traced) === focusKeyOf(field);
    select(undefined);
    traced = same ? undefined : field;
    renderPages();
    if (traced) showChain(chainOf(traced));
    scheduleDraw();
  }

  /** Scrolls the grid to a chain's operators on this page, unless one's already in view. */
  function showChain(chain: Chain) {
    const elements = [...chain.nodes].flatMap((id) => nodeElements.get(id) ?? []);
    if (elements.length === 0) return;
    const view = viewport.getBoundingClientRect();
    const seen = elements.some((e) => {
      const box = e.getBoundingClientRect();
      return box.bottom > view.top && box.top < view.bottom && box.right > view.left && box.left < view.right;
    });
    if (seen) return;
    viewport.scrollTop = Math.max(0, Math.min(...elements.map((e) => e.offsetTop)) * zoom - 40);
    viewport.scrollLeft = Math.max(0, Math.min(...elements.map((e) => e.offsetLeft)) * zoom - 40);
  }

  // The lines' paths from the last drawing, reused in the same order, so a redraw only
  // changes the lines that moved, rather than replacing thousands of elements every frame.
  const linePaths = new WeakSet<SVGPathElement>();
  let spare: SVGPathElement[] = [];
  let spareAt = 0;

  const line = (a: Point, b: Point, classes: string, hit?: string): SVGElement[] => {
    // A line to a field out of view is drawn in full to the tree's edge, but faded; one with
    // neither end in view isn't drawn.
    if (offscreen.has(a) && offscreen.has(b)) return [];
    const away = offscreen.has(a) || offscreen.has(b);
    const d = linkPath(theme.links, a, b);
    const make = (className: string, hit?: string) => {
      const element = spare[spareAt++] ?? document.createElementNS(SVG, "path");
      linePaths.add(element);
      if (element.getAttribute("d") !== d) element.setAttribute("d", d);
      if (element.getAttribute("class") !== className) element.setAttribute("class", className);
      if (hit === undefined) delete element.dataset.hit;
      else if (element.dataset.hit !== hit) element.dataset.hit = hit;
      return element;
    };
    const visible = make(`cw-line ${classes}${away ? " cw-offscreen" : ""}`);
    return hit ? [visible, make("cw-hit", hit)] : [visible];
  };

  /** A link from a source record to a target record, rather than between values. */
  const isRecordLink = (link: Link) => "source" in link.from && "target" in link.to && targetRows.get(link.to.target)?.dataset.value === "false";

  /** The loop whose items a record link maps, if it's one. */
  const itemLoop = (link: Link) =>
    "source" in link.from && "target" in link.to
      ? map.loops?.find((loop) => "source" in link.from && loop.source === link.from.source && "target" in link.to && loop.target === link.to.target)
      : undefined;

  /** The source fields a value comes from, through any operators. */
  const sourcesOf = (from: LinkSource) => sourcesIn(map, from);

  /** A label on a record link's line: the sub-map it uses, or that it copies. Double-click opens the sub-map. */
  const pill = (a: Point, b: Point, text: string, hit: string, submap: string | undefined, classes: string): SVGElement => {
    const group = document.createElementNS(SVG, "g");
    group.setAttribute("class", `cw-pill ${classes}`.trim());
    group.dataset.hit = hit;
    if (submap !== undefined) group.dataset.submap = submap;
    const width = text.length * 6.4 + 16;
    // Three-quarters along, towards the target: operators tend to sit in the middle.
    const at = pointOnLink(theme.links, a, b, 0.75);
    const x = at.x - width / 2;
    const y = at.y - 9;
    const rect = document.createElementNS(SVG, "rect");
    for (const [name, value] of Object.entries({ x, y, width, height: 18, rx: 9 })) rect.setAttribute(name, String(value));
    const label = document.createElementNS(SVG, "text");
    label.setAttribute("x", String(x + width / 2));
    label.setAttribute("y", String(y + 12.5));
    label.setAttribute("text-anchor", "middle");
    label.textContent = text;
    const title = document.createElementNS(SVG, "title");
    title.textContent = submap === undefined ? t.copied : t.mappedWith(submap);
    group.append(title, rect, label);
    return group;
  };

  const describeAnchor = (on: NoteAnchor) =>
    t.noteOn("node" in on ? on : { field: "target" in on ? on.target : on.source });

  /**
   * The point a note on something sits beside: an operator's middle, the
   * middle of a line or loop, or a field's end of the tree.
   */
  const anchorPoint = (on: NoteAnchor, frame: DOMRect): Point | undefined => {
    const middle = (a: Point | undefined, b: Point | undefined) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined);
    if ("source" in on) return rowAnchor("source", on.source, frame);
    if ("target" in on) {
      const end = rowAnchor("target", on.target, frame);
      const loop = map.loops?.find((l) => l.target === on.target);
      const link = map.links.find((l) => "target" in l.to && l.to.target === on.target);
      const from = loop ? rowAnchor("source", loop.source, frame) : link ? fromAnchor(link.from, frame) : undefined;
      return middle(from, end) ?? end;
    }
    const element = nodeElements.get(on.node);
    if (!element) return undefined;
    if (on.input !== undefined) {
      const link = map.links.find((l) => "node" in l.to && l.to.node === on.node && l.to.input === on.input);
      const into = middle(link ? fromAnchor(link.from, frame) : undefined, nodeAnchor(on.node, "in", frame));
      if (into) return into;
    }
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - frame.left, y: rect.top + rect.height / 2 - frame.top };
  };

  /** The note being dragged, which follows the pointer rather than what it's on. */
  let draggingNote: string | undefined;

  /** Puts each pinned note beside what it's on, with a leader line back to it. */
  const placePinnedNotes = (frame: DOMRect): SVGElement[] => {
    // Notes are put away while a search narrows the map.
    root.classList.toggle("cw-search-on", searching());
    if (searching()) return [];
    const leaders: SVGElement[] = [];
    let moved = false;
    for (const note of map.notes ?? []) {
      const element = noteElements.get(note.id);
      if (!element || !note.on) continue;
      const point = anchorPoint(note.on, frame);
      if (!point) continue;
      if (note.id !== draggingNote) {
        const left = `${Math.round((point.x + viewport.scrollLeft) / zoom + note.position.x)}px`;
        const top = `${Math.round((point.y + viewport.scrollTop) / zoom + note.position.y)}px`;
        moved ||= element.style.left !== left || element.style.top !== top;
        element.style.left = left;
        element.style.top = top;
      }
      const box = { left: element.offsetLeft * zoom - viewport.scrollLeft, top: element.offsetTop * zoom - viewport.scrollTop };
      const near = {
        x: Math.min(Math.max(point.x, box.left), box.left + element.offsetWidth * zoom),
        y: Math.min(Math.max(point.y, box.top), box.top + element.offsetHeight * zoom),
      };
      if (Math.hypot(near.x - point.x, near.y - point.y) < 6) continue;
      const leader = document.createElementNS(SVG, "path");
      leader.setAttribute("d", `M ${point.x} ${point.y} L ${near.x} ${near.y}`);
      leader.setAttribute("class", "cw-leader");
      const dot = document.createElementNS(SVG, "circle");
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", "2.5");
      dot.setAttribute("class", "cw-leader-dot");
      leaders.push(leader, dot);
    }
    if (moved) fitHeight();
    return leaders;
  };

  /** What's under the pointer that a note could be pinned to. */
  const anchorAt = (event: PointerEvent): NoteAnchor | undefined => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || !root.contains(element)) return undefined;
    const node = element.closest<HTMLElement>(".cw-node")?.dataset.id;
    if (node) return { node };
    const hit = element.closest<SVGElement>("[data-hit]")?.dataset.hit;
    if (hit) {
      const [kind, ...rest] = hit.split(":");
      const value = rest.join(":");
      if (kind === "loop") return { target: value };
      if (kind === "node") return { node: value };
      const link = map.links[Number(value)];
      if (kind === "link" && link) return "target" in link.to ? { target: link.to.target } : { node: link.to.node, input: link.to.input };
    }
    const path = element.closest<HTMLElement>(".cw-row")?.dataset.path;
    if (path) return element.closest(".cw-source") ? { source: path } : { target: path };
    return undefined;
  };

  /**
   * Where a note at `position` on the surface goes in the document: relative
   * to what it's pinned to, if anything. Newly pinned, it starts just beside
   * the thing, since where it was dropped is on top of it.
   */
  const notePlacement = (position: Position, on: NoteAnchor | undefined, newlyPinned: boolean): { position: Position; on: NoteAnchor | undefined } => {
    const point = on && anchorPoint(on, grid.getBoundingClientRect());
    if (!point) return { position, on: undefined };
    if (newlyPinned) return { position: { x: 24, y: 22 }, on };
    return { position: { x: position.x - (point.x + viewport.scrollLeft) / zoom, y: position.y - (point.y + viewport.scrollTop) / zoom }, on };
  };

  /** Unpins a note, leaving it where it is. */
  function unpin(id: string) {
    const note = map.notes?.find((n) => n.id === id);
    if (!note?.on) return;
    const point = anchorPoint(note.on, grid.getBoundingClientRect());
    const position = point
      ? { x: (point.x + viewport.scrollLeft) / zoom + note.position.x, y: (point.y + viewport.scrollTop) / zoom + note.position.y }
      : note.position;
    commit(edits.placeNote(map, id, position, undefined));
  }

  const STUB = 44;

  /** A short line, labelled with the page it carries on to or comes from. Clicking the label goes there. */
  const pageStub = (from: Point, to: Point, direction: "to" | "from", id: string | undefined, classes = ""): SVGElement[] => {
    const text = t.carriesOn(direction, pageName(id));
    const group = document.createElementNS(SVG, "g");
    group.setAttribute("class", "cw-page-stub");
    group.dataset.hit = `page:${id ?? ""}`;
    const width = text.length * 6 + 14;
    const outgoing = direction === "to";
    // The label sits at the stub's loose end.
    const end = outgoing ? to : from;
    const x = outgoing ? end.x : end.x - width;
    const rect = document.createElementNS(SVG, "rect");
    Object.entries({ x, y: end.y - 9, width, height: 18, rx: 9 }).forEach(([key, value]) => rect.setAttribute(key, String(value)));
    const label = document.createElementNS(SVG, "text");
    Object.entries({ x: x + width / 2, y: end.y + 3.5, "text-anchor": "middle" }).forEach(([key, value]) => label.setAttribute(key, String(value)));
    label.textContent = text;
    group.append(rect, label);
    const title = document.createElementNS(SVG, "title");
    title.textContent = t.carriesOnHint(direction, pageName(id));
    group.append(title);
    return [...line(from, to, `cw-offpage${classes}`), group];
  };

  /**
   * For a line between an operator here and one on another page: a stub at
   * this page's end, since the input would otherwise look empty. A field
   * mapped from another page needs none: it's shown as mapped in its tree.
   */
  const offPage = (link: Link, a: Point | undefined, b: Point | undefined, classes = ""): SVGElement[] => {
    const elsewhere = (id: string) => {
      const node = map.nodes.find((n) => n.id === id);
      return node && !onPage(node) ? edits.pageOf(map, node) : undefined;
    };
    if (a && "node" in link.from && "node" in link.to) {
      const id = elsewhere(link.to.node);
      return id === undefined ? [] : pageStub(a, { x: a.x + STUB, y: a.y }, "to", id, classes);
    }
    if (b && "node" in link.from && "node" in link.to) {
      const id = elsewhere(link.from.node);
      return id === undefined ? [] : pageStub({ x: b.x - STUB, y: b.y }, b, "from", id, classes);
    }
    return [];
  };

  const drawLinks = () => {
    const started = performance.now();
    // Everything is measured before any line changes: measuring after a change makes the
    // browser lay out every line again, once per measurement.
    measured = new Map();
    const panes = [sourceTree, targetTree, sourceTree.firstElementChild, targetTree.firstElementChild];
    for (const element of [...panes, ...sourceRows.values(), ...targetRows.values(), ...nodeElements.values()]) {
      if (element) measured.set(element, element.getBoundingClientRect());
    }
    spare = [...svg.children].filter((element): element is SVGPathElement => linePaths.has(element as SVGPathElement));
    spareAt = 0;
    try {
      drawLines();
    } finally {
      measured = undefined;
      spare = [];
    }
    options.onPerformance?.({ kind: "redraw", ms: performance.now() - started });
  };

  const drawLines = () => {
    const frame = grid.getBoundingClientRect();
    const lines: SVGElement[] = [];
    const selected = selection?.kind === "node" ? { kind: "node" as const, id: selection.id } : undefined;
    // A traced field wins; otherwise what's hovered picks out its own lines, and a selected operator its whole chain.
    const focus = traced ?? hovered ?? selected;
    const focusKey = focus && focusKeyOf(focus);
    const chainFocus = traced ?? (hovered ? undefined : selected);
    const chain = chainFocus && chainOf(chainFocus);
    const inChain = (end: Focus) =>
      chain !== undefined && (end.kind === "node" ? chain.nodes.has(end.id) : (end.kind === "source" ? chain.sources : chain.targets).has(end.path));
    const relatedRows = new Set<HTMLElement>();
    const relatedNodes = new Set<string>();
    const relate = (ends: Focus[]) => {
      if (chain ? !ends.every(inChain) : !ends.some((end) => focusKeyOf(end) === focusKey)) return "";
      for (const end of ends) {
        if (end.kind === "node") relatedNodes.add(end.id);
        else {
          const row = (end.kind === "source" ? sourceRows : targetRows).get(end.path);
          if (row) relatedRows.add(row);
        }
      }
      return " cw-related";
    };
    const endOf = (from: LinkSource): Focus => ("source" in from ? { kind: "source", path: from.source } : { kind: "node", id: from.node });
    // While a tree is searched, only lines on the paths from what matches are drawn.
    const narrowed = Object.values(searchChains());
    const inOne = (c: Chain, end: Focus) => (end.kind === "node" ? c.nodes.has(end.id) : (end.kind === "source" ? c.sources : c.targets).has(end.path));
    const kept = (ends: Focus[]) => narrowed.every((c) => ends.every((end) => inOne(c, end)));

    // What each record link maps, field to field, finely dotted beneath everything else.
    const pills: SVGElement[] = [];
    map.links.forEach((link, index) => {
      const ends = recordEnds(map, link);
      if (!ends) return;
      // A record's items mapped whole are drawn with their loop, and are on its page.
      const owner = itemLoop(link);
      if (!onPage(owner ?? link)) return;
      if (!kept([{ kind: "source", path: ends.from }, { kind: "target", path: ends.to }])) return;
      for (const mapping of recordMappings(map, link)) {
        const a = rowAnchor("source", mapping.source, frame);
        const b = rowAnchor("target", mapping.target, frame);
        if (!a || !b) continue;
        lines.push(...line(a, b, `cw-submap-line${relate([{ kind: "source", path: mapping.source }, { kind: "target", path: mapping.target }])}`));
      }
      const a = rowAnchor("source", ends.from, frame);
      const b = rowAnchor("target", ends.to, frame);
      const loop = itemLoop(link);
      const selected = loop ? selection?.kind === "loop" && selection.target === loop.target : selection?.kind === "link" && selection.index === index;
      if (a && b && !offscreen.has(a) && !offscreen.has(b)) pills.push(pill(a, b, link.submap ?? t.copy, loop ? `loop:${loop.target}` : `link:${index}`, link.submap, selected ? "cw-selected" : ""));
    });
    if (hideOperators) {
      // One line from each source field to each target field it ends up in.
      const drawn = new Set<string>();
      for (const link of map.links) {
        if (!("target" in link.to) || itemLoop(link)) continue;
        const b = rowAnchor("target", link.to.target, frame);
        for (const source of sourcesOf(link.from)) {
          const key = `${source}\n${link.to.target}`;
          const a = rowAnchor("source", source, frame);
          if (drawn.has(key) || !a || !b) continue;
          if (!kept([{ kind: "source", path: source }, { kind: "target", path: link.to.target }])) continue;
          drawn.add(key);
          const through = "node" in link.from ? "cw-through" : isRecordLink(link) ? "cw-record-link" : "";
          lines.push(...line(a, b, `${through}${relate([{ kind: "source", path: source }, { kind: "target", path: link.to.target }])}`));
        }
      }
    }
    map.links.forEach((link, index) => {
      // A loop's items mapped whole: the loop's own line stands for it.
      if (itemLoop(link)) return;
      if (hideOperators) return;
      if ("source" in link.from && "target" in link.to && !onPage(link)) return;
      if (!kept([endOf(link.from), "target" in link.to ? { kind: "target", path: link.to.target } : { kind: "node", id: link.to.node }])) return;
      const a = fromAnchor(link.from, frame);
      const b = "target" in link.to ? rowAnchor("target", link.to.target, frame) : nodeAnchor(link.to.node, "in", frame);
      if (!a || !b) {
        lines.push(...offPage(link, a, b, relate([endOf(link.from), "target" in link.to ? { kind: "target", path: link.to.target } : { kind: "node", id: link.to.node }])));
        return;
      }
      const selected = selection?.kind === "link" && selection.index === index;
      const to: Focus = "target" in link.to ? { kind: "target", path: link.to.target } : { kind: "node", id: link.to.node };
      const record = isRecordLink(link) ? "cw-record-link " : "";
      lines.push(...line(a, b, `${record}${selected ? "cw-selected" : ""}${relate([endOf(link.from), to])}`, `link:${index}`));
    });
    for (const loop of map.loops ?? []) {
      if (!onPage(loop)) continue;
      if (!kept([{ kind: "source", path: loop.source }, { kind: "target", path: loop.target }])) continue;
      const a = rowAnchor("source", loop.source, frame);
      const b = rowAnchor("target", loop.target, frame);
      if (!a || !b) continue;
      const selected = selection?.kind === "loop" && selection.target === loop.target;
      const related = relate([{ kind: "source", path: loop.source }, { kind: "target", path: loop.target }]);
      lines.push(...line(a, b, `cw-loop${selected ? " cw-selected" : ""}${related}`, `loop:${loop.target}`));
    }
    for (const node of map.nodes) {
      if (!node.scope || !kept([{ kind: "source", path: node.scope }, { kind: "node", id: node.id }])) continue;
      const a = rowAnchor("source", node.scope, frame);
      const b = nodeAnchor(node.id, "in", frame);
      const related = relate([{ kind: "source", path: node.scope }, { kind: "node", id: node.id }]);
      if (a && b) lines.push(...line(a, b, `cw-scope${related}`, `node:${node.id}`));
    }
    if (chain) {
      for (const path of chain.sources) sourceRows.get(path) && relatedRows.add(sourceRows.get(path)!);
      for (const path of chain.targets) targetRows.get(path) && relatedRows.add(targetRows.get(path)!);
      for (const id of chain.nodes) relatedNodes.add(id);
    }
    for (const [path, row] of [...sourceRows, ...targetRows]) row.classList.toggle("cw-traced", traced !== undefined && "path" in traced && traced.path === path && (traced.kind === "source" ? sourceRows : targetRows).get(path) === row);
    svg.classList.toggle("cw-focus", focus !== undefined && !dragLine);
    for (const row of [...sourceRows.values(), ...targetRows.values()]) row.classList.toggle("cw-related", relatedRows.has(row));
    for (const [id, element] of nodeElements) {
      element.classList.toggle("cw-related", relatedNodes.has(id));
      // Operators off the search's paths are hidden, like their lines.
      element.classList.toggle("cw-filtered", !narrowed.every((c) => c.nodes.has(id)));
    }
    lines.push(...pills);
    if (dragLine) {
      const a = dragLine.from(frame);
      if (a) lines.push(...line(a, dragLine.to, "cw-drag"));
    }
    lines.push(...placePinnedNotes(frame));
    // Moves only what's out of place, so lines that didn't change aren't touched.
    lines.forEach((element, index) => {
      if (svg.children[index] !== element) svg.insertBefore(element, svg.children[index] ?? null);
    });
    while (svg.children.length > lines.length) svg.lastElementChild!.remove();
  };

  let frameRequest = 0;
  const scheduleDraw = () => {
    if (frameRequest) return;
    frameRequest = requestAnimationFrame(() => {
      frameRequest = 0;
      drawLinks();
    });
  };

  // ---- inspector ----

  const describe = (from: LinkSource) => {
    if ("source" in from) return from.source;
    const node = map.nodes.find((n) => n.id === from.node);
    return `${from.node} (${operatorText(registry.get(node?.operator ?? ""), node?.operator ?? "?").label})`;
  };

  const iconButton = (label: string, onClick: () => void, icon = "✕", extraClass = "") => {
    const button = h("button", { class: `cw-icon-button ${extraClass}`.trim(), type: "button", title: label, "aria-label": label }, icon);
    button.addEventListener("click", onClick);
    return button;
  };

  const deleteButton = (label: string) => {
    const button = h("button", { class: "cw-delete", type: "button" }, label);
    button.addEventListener("click", deleteSelection);
    return button;
  };

  // Suggestions for an input box: the source fields, and the other operators' outputs.
  const fieldListId = `cw-inputs-${++editors}`;

  const inputChoices = (id: string) => {
    const list = h("datalist", { id: fieldListId });
    for (const field of listFields(map.source)) {
      if (isValueSchema(field.schema)) list.append(h("option", { value: field.path, label: "source field" }));
    }
    for (const other of map.nodes) {
      if (other.id !== id) list.append(h("option", { value: other.id, label: t.outputOf(operatorText(registry.get(other.operator), other.operator).label) }));
    }
    return list;
  };

  /** What typed text links to: a source field's path, or another operator's id. */
  const linkFor = (text: string, id: string): LinkSource | undefined => {
    if (listFields(map.source).some((field) => field.path === text && isValueSchema(field.schema))) return { source: text };
    if (text !== id && map.nodes.some((node) => node.id === text)) return { node: text };
    return undefined;
  };

  const constantInput = (id: string, index: number, value: JsonValue | undefined) => {
    const input = h("input", {
      type: "text",
      placeholder: t.inputPlaceholder,
      list: fieldListId,
      "aria-label": t.inputHint(index),
    });
    if (value !== undefined) input.value = formatConstant(value);
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("change", () => {
      // A field or operator links to the input, as dragging it there would. Anything else is a constant.
      const from = linkFor(input.value.trim(), id);
      if (!from) return commit(edits.setConstant(map, id, index, parseConstant(input.value)));
      const linked = edits.setInputLink(map, id, index, from);
      if (linked) return commit(linked);
      input.setCustomValidity(`${input.value.trim()} already reads from this operator, so linking it would make a loop`);
      input.reportValidity();
    });
    return input;
  };

  const tableInput = (id: string, index: number, table: Record<string, JsonValue>) => {
    const text = h("textarea", { class: "cw-table", rows: "4", spellcheck: "false", placeholder: "M = Male\nF = Female", "aria-label": t.tableHint(index) });
    text.value = formatTable(table);
    text.addEventListener("change", () => commit(edits.setConstant(map, id, index, parseTable(text.value))));
    return text;
  };

  /** Fields of a loop's source item that it can sort or group by. */
  const itemFields = (loop: Loop) =>
    listFields(map.source)
      .filter((f) => f.path.startsWith(`${loop.source}.`) && !f.path.slice(loop.source.length).includes("[]") && isValueSchema(f.schema))
      .map((f) => f.path);

  const fieldSelect = (label: string, fields: string[], current: string | undefined, prompt: string, onChange: (path: string | undefined) => void) => {
    const select = h("select", { "aria-label": label });
    select.append(new Option(prompt, ""));
    for (const path of fields) select.append(new Option(path, path, false, path === current));
    select.addEventListener("change", () => onChange(select.value === "" ? undefined : select.value));
    return select;
  };

  /**
   * How a record link maps its record: copied as it is, or with a sub-map,
   * with a choice to make a new one. `fieldByField` offers no record link at
   * all, for a loop's items.
   */
  const recordMapping = (from: string, to: string, current: Link | undefined, fieldByField: boolean): Child[] => {
    const select = h("select", { "aria-label": t.mapWith });
    if (fieldByField) select.append(new Option(t.fieldByField, "-", false, current === undefined));
    select.append(new Option(t.copyAsItIs, "", false, current !== undefined && current.submap === undefined));
    for (const name of Object.keys(doc.submaps ?? {})) select.append(new Option(t.subMap(name), `=${name}`, false, current?.submap === name));
    select.append(new Option(t.newSubMap, "+"));
    select.addEventListener("change", () => {
      if (select.value === "-") return commit(edits.removeRecordLink(map, from, to));
      if (select.value === "") return commit(edits.setRecordLink(map, from, to, undefined));
      if (select.value.startsWith("=")) return commit(edits.setRecordLink(map, from, to, select.value.slice(1)));
      const created = edits.createSubmap(map, from, to);
      if (created) commit(created.document, created.name);
    });
    const name = current?.submap;
    const problems = name === undefined ? [] : issues.filter((i) => i.submap === name && i.severity === "error");
    return [
      select,
      name !== undefined && h("p", {}, problems.length > 0 ? t.subMapErrors(problems.length) : ""),
      name !== undefined && textButton(t.open(name), () => showLevel(name)),
    ];
  };

  /** The notes pinned to something, for its inspector. */
  const pinnedNotes = (matches: (on: NoteAnchor) => boolean): HTMLElement[] => {
    const notes = (map.notes ?? []).filter((note) => note.on && matches(note.on) && note.text.trim() !== "");
    return notes.length === 0 ? [] : [h("h4", {}, t.notes), ...notes.map((note) => h("p", { class: "cw-note-quote" }, note.text))];
  };

  const issueNote = (issue: MapIssue) => h("p", { class: `cw-issue${issue.severity === "warning" ? " cw-warning" : ""}` }, t.issue(issue));

  const textButton = (label: string, onClick: () => void) => {
    const button = h("button", { class: "cw-button", type: "button" }, label);
    button.addEventListener("click", onClick);
    return button;
  };

  /** Moves what's selected to another page, once the map has more than one. The page shown goes with it. */
  const pagePicker = (move: PageMove): HTMLElement[] => {
    if (pages().length < 2 || readOnly || !showPages) return [];
    const picker = h("select", { "aria-label": t.page });
    for (const p of pages()) picker.append(new Option(p.name, p.id, false, p.id === activePage()));
    picker.addEventListener("change", () => {
      page = picker.value;
      commit(move(map, picker.value));
    });
    return [h("h4", {}, t.page), picker];
  };
  const linePicker = (line: edits.PagedLine) => pagePicker((document, id) => edits.moveLineToPage(document, line, id));

  const renderNodeInspector = (id: string) => {
    const node = map.nodes.find((n) => n.id === id);
    if (!node) return;
    const definition = registry.get(node.operator);
    const content: Child[] = [
      inputChoices(id),
      h(
        "h3",
        {},
        h("span", { class: `cw-chip cw-cat-${definition?.category ?? "unknown"}` }, glyphOf(definition)),
        h("span", {}, operatorText(definition, node.operator).label, h("span", { class: "cw-id" }, node.id)),
        iconButton(t.close, () => select(undefined)),
      ),
      operatorText(definition, node.operator).description && h("p", {}, operatorText(definition, node.operator).description!),
    ];

    const links = new Map<number, LinkSource>();
    for (const link of map.links) if ("node" in link.to && link.to.node === id) links.set(link.to.input, link.from);
    const indices = [...links.keys(), ...Object.keys(node.constants ?? {}).map(Number)];
    const used = indices.length === 0 ? 0 : Math.max(...indices) + 1;
    const min = definition?.inputs.min ?? 0;
    const max = definition?.inputs.max;
    // Show every input in use or required, plus one empty slot to add a constant to.
    const rows = Math.max(used, min) + (max === undefined || Math.max(used, min) < max ? 1 : 0);

    if (definition?.kind !== "aggregate" || rows > 0) content.push(h("h4", {}, t.inputs));
    for (let index = 0; index < rows; index++) {
      const label = operatorText(definition, node.operator).inputs?.[index] ?? t.inputLabel(index);
      const from = links.get(index);
      const constant = node.constants?.[index];
      const filled = from !== undefined || constant !== undefined;
      const table = from === undefined && isTable(constant);
      content.push(
        h(
          "div",
          { class: "cw-input" },
          h("span", { class: "cw-input-label", title: label }, label),
          from
            ? h("span", { class: "cw-from", title: describe(from) }, `← ${describe(from)}`)
            : table
              ? h("span", { class: "cw-from" }, t.tableOf(Object.keys(constant).length))
              : constantInput(id, index, constant),
          index > 0 && filled
            ? iconButton(t.moveInputUp(index), () => commit(edits.swapInputs(map, id, index - 1, index)), "↑")
            : !filled && definition?.inputs.tables?.includes(index)
              ? iconButton(t.useTable(index), () => commit(edits.setConstant(map, id, index, {})), "⊞")
              : h("span"),
          filled ? iconButton(t.removeInput(index), () => commit(edits.removeInput(map, id, index)), "✕", "cw-remove") : h("span"),
        ),
      );
      if (table) content.push(tableInput(id, index, constant));
    }

    if (definition?.kind === "aggregate") {
      const scope = h("select", { "aria-label": t.aggregatesOver });
      scope.append(new Option(t.chooseRepeating, ""));
      for (const field of listFields(map.source)) {
        if (field.repeating) scope.append(new Option(field.path, field.path, false, field.path === node.scope));
      }
      scope.addEventListener("change", () => commit(edits.setScope(map, id, scope.value === "" ? undefined : scope.value)));
      content.push(h("h4", {}, t.aggregatesOver), scope);
    }

    content.push(...pagePicker(movingIds([id])));
    content.push(...pinnedNotes((on) => "node" in on && on.node === id));
    for (const issue of issues.filter((i) => i.node === id)) {
      content.push(issueNote(issue));
    }
    content.push(deleteButton(t.deleteOperator));
    inspector.replaceChildren(...content.filter((c): c is Node | string => Boolean(c)));
  };

  /**
   * The inspector opens for what has something to set: an operator, a record
   * link's sub-map, a loop's sorting and grouping. A plain line, or several
   * operators, is just picked out; Delete, copy and paste work on it all the same.
   */
  const inspected = (s: Selection) =>
    s?.kind === "node" || s?.kind === "loop" || (s?.kind === "link" && map.links[s.index] !== undefined && isRecordLink(map.links[s.index]!));

  const renderInspector = () => {
    inspector.classList.toggle("cw-open", inspected(selection));
    if (!inspected(selection)) return inspector.replaceChildren();
    if (selection?.kind === "node") return renderNodeInspector(selection.id);
    if (selection?.kind === "link") {
      const link = map.links[selection.index]!;
      const from = (link.from as { source: string }).source;
      const to = (link.to as { target: string }).target;
      inspector.replaceChildren(
        ...([
          h("h3", {}, t.recordLink, iconButton(t.close, () => select(undefined))),
          h("p", {}, `${from} → ${to}`),
          h("h4", {}, t.mapWith),
          ...recordMapping(from, to, link, false),
          ...linePicker({ kind: "link", index: selection.index }),
          ...pinnedNotes((on) => "target" in on && on.target === to),
          ...issues.filter((i) => i.submap === undefined && i.path === to).map(issueNote),
          deleteButton(t.deleteLink),
        ].filter((c): c is HTMLElement => Boolean(c))),
      );
      return;
    }
    if (selection?.kind === "loop") {
      const loop = map.loops?.find((l) => l.target === (selection as { target: string }).target);
      if (!loop) return;
      const fields = itemFields(loop);
      const set = (options: Parameters<typeof edits.setLoopOptions>[2]) => commit(edits.setLoopOptions(map, loop.target, options));
      const sortBy = loop.sortBy ?? [];
      const sortRows = sortBy.map((key, index) => {
        const replace = (next: SortKey | undefined) => set({ sortBy: sortBy.flatMap((k, i) => (i !== index ? [k] : next ? [next] : [])) });
        const direction = textButton(key.descending ? t.descending : t.ascending, () => replace({ path: key.path, ...(key.descending ? {} : { descending: true }) }));
        direction.title = key.descending ? t.descendingHint : t.ascendingHint;
        return h(
          "div",
          { class: "cw-sort" },
          fieldSelect(t.sortKey(index), fields, key.path, t.chooseField, (path) => replace(path ? { ...key, path } : undefined)),
          direction,
          iconButton(t.removeSortKey(index), () => replace(undefined), "✕", "cw-remove"),
        );
      });
      const distinct = h("input", { type: "checkbox" });
      distinct.checked = loop.distinct ?? false;
      distinct.addEventListener("change", () => set({ distinct: distinct.checked }));
      const sourceItem = edits.recordSchema(map.source, loop.source);
      const targetItem = edits.recordSchema(map.target, loop.target);
      const itemLink = map.links.find((l) => itemLoop(l) === loop);
      inspector.replaceChildren(
        ...([
          h("h3", {}, t.loop, iconButton(t.close, () => select(undefined))),
          h("p", {}, `${loop.target} repeats once per item of ${loop.source}.`),
          h("h4", {}, t.sortBy),
          ...sortRows,
          fieldSelect(t.addSortKey, fields.filter((f) => !sortBy.some((k) => k.path === f)), undefined, sortBy.length > 0 ? t.thenBy : t.keepOrder, (path) => path && set({ sortBy: [...sortBy, { path }] })),
          h("h4", {}, t.groupBy),
          fieldSelect(t.groupBy, fields, loop.groupBy, t.oneEach, (path) => set({ groupBy: path })),
          h("label", { class: "cw-check" }, distinct, t.leaveOutRepeats),
          ...(sourceItem && targetItem ? [h("h4", {}, t.mapEachItem), ...recordMapping(loop.source, loop.target, itemLink, true)] : []),
          ...linePicker({ kind: "loop", target: loop.target }),
          ...pinnedNotes((on) => "target" in on && on.target === loop.target),
          ...issues.filter((i) => i.submap === undefined && i.path === loop.target).map(issueNote),
          deleteButton(t.deleteLoop),
        ].filter((c): c is HTMLElement => Boolean(c))),
      );
      return;
    }
    inspector.replaceChildren();
  };

  // ---- state ----

  /** The operators selected: one, several, or none. */
  const selectedIds = (): string[] => (selection?.kind === "node" ? [selection.id] : selection?.kind === "nodes" ? selection.ids : []);

  const selectionExists = (s: Selection) => {
    if (!s) return true;
    if (s.kind === "node") return map.nodes.some((n) => n.id === s.id);
    if (s.kind === "nodes") return s.ids.every((id) => map.nodes.some((n) => n.id === id));
    if (s.kind === "link") return s.index < map.links.length;
    return (map.loops ?? []).some((l) => l.target === s.target);
  };

  const applySelection = () => {
    const chosen = new Set(selectedIds());
    for (const [id, element] of nodeElements) element.classList.toggle("cw-selected", chosen.has(id));
    renderInspector();
    scheduleDraw();
    tell("selection", publicSelection(), (value) => options.onSelectionChange?.(value));
  };

  /** The selection as the host sees it. */
  const publicSelection = (): MapperSelection | undefined =>
    selection === undefined
      ? undefined
      : selection.kind === "node"
        ? { kind: "operator", id: selection.id }
        : selection.kind === "nodes"
          ? { kind: "operators", ids: [...selection.ids] }
          : { ...selection };

  // What the host was last told, so each event fires only on a change.
  const told = new Map<string, string>([["selection", ""]]);
  function tell<T>(event: string, value: T, call: (value: T) => void) {
    const key = JSON.stringify(value) ?? "";
    if (told.get(event) === key) return;
    told.set(event, key);
    call(value);
  }

  function select(next: Selection) {
    selection = next;
    if (traced) {
      traced = undefined;
      renderPages();
    }
    applySelection();
  }

  // ---- preview ----

  let previewInput = options.preview?.input;
  let previewOutput: JsonValue | undefined;
  let failedNode: string | undefined;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewRun: AbortController | undefined;

  /** The output at a target path: a value, or how many items for a repeating field. Fields inside arrays show the first item's. */
  const sampleAt = (path: string): { value: JsonValue } | { count: number } | undefined => {
    if (previewOutput === undefined || level !== undefined) return undefined;
    let current: JsonValue | undefined = previewOutput;
    const segments = parsePath(path);
    for (const [position, segment] of segments.entries()) {
      if (typeof current !== "object" || current === null || Array.isArray(current) || !Object.hasOwn(current, segment.key)) return undefined;
      current = current[segment.key];
      if (!segment.array) continue;
      if (!Array.isArray(current)) return undefined;
      if (position === segments.length - 1) return { count: current.length };
      current = current[0];
    }
    return current === undefined ? undefined : { value: current };
  };

  function applySamples() {
    for (const [path, row] of targetRows) {
      const sample = row.querySelector<HTMLElement>(".cw-sample");
      if (!sample) continue;
      // A sub-map's fields have no single value: it runs once for each record it maps.
      const shown = level === undefined ? previewOutput : undefined;
      const found = shown === undefined ? undefined : sampleAt(path);
      const record = row.classList.contains("cw-record");
      sample.classList.toggle("cw-left-out", shown !== undefined && found === undefined && !record);
      if (shown === undefined || record) {
        sample.textContent = "";
        sample.removeAttribute("title");
      } else if (found === undefined) {
        sample.textContent = t.leftOut;
        sample.title = t.leftOutHint;
      } else if ("count" in found) {
        sample.textContent = t.items(found.count);
        sample.title = `${found.count} in the output for the sample input`;
      } else {
        sample.textContent = JSON.stringify(found.value);
        sample.title = path.includes("[]") ? t.firstItemValue(JSON.stringify(found.value)) : JSON.stringify(found.value);
      }
    }
  }

  const applyFailedNode = () => {
    for (const [id, element] of nodeElements) element.classList.toggle("cw-preview-failed", level === undefined && id === failedNode);
  };

  const showPreviewStatus = (message: string | undefined, kind: "error" | "info" = "error") => {
    previewStatus.hidden = message === undefined;
    previewStatus.textContent = message ?? "";
    previewStatus.classList.toggle("cw-info", kind === "info");
  };

  const settlePreview = (output: JsonValue | undefined, failed?: string, message?: string, kind: "error" | "info" = "error") => {
    previewOutput = output;
    failedNode = failed;
    applySamples();
    applyFailedNode();
    showPreviewStatus(message, kind);
  };

  const runPreview = async () => {
    previewRun?.abort();
    const run = new AbortController();
    previewRun = run;
    if (previewInput === undefined) return settlePreview(undefined);
    const request = { map: structuredClone(doc), input: previewInput };
    const remote = [doc, ...Object.values(doc.submaps ?? {})].flatMap((m) => m.nodes.filter((node) => registry.get(node.operator)?.remote).map((node) => node.id));
    let response: PreviewResponse;
    try {
      if (options.preview?.run) response = await options.preview.run(request, { signal: run.signal });
      else if (remote.length > 0) {
        return settlePreview(undefined, undefined, t.previewNeedsRunner(remote), "info");
      } else response = await handlePreview(request, { registry, signal: run.signal });
    } catch (error) {
      if (run.signal.aborted) return;
      return settlePreview(undefined, undefined, t.previewFailed(error instanceof Error ? error.message : String(error)));
    }
    // A newer edit has started its own run.
    if (run !== previewRun) return;
    if ("output" in response) return settlePreview(response.output);
    if ("error" in response) return settlePreview(undefined, response.error.node, response.error.message);
    // Errors the editor already shows need no repeat; ones only the server found do.
    const serverOnly = response.issues.find((issue) => issue.severity === "error" && !issues.some((local) => local.code === issue.code && local.message === issue.message));
    return settlePreview(undefined, undefined, serverOnly ? t.serverCantRun(t.issue(serverOnly)) : undefined);
  };

  const schedulePreview = () => {
    clearTimeout(previewTimer);
    if (previewInput === undefined) return settlePreview(undefined);
    previewTimer = setTimeout(() => void runPreview(), options.preview?.delay ?? 250);
  };

  const refresh = () => {
    const started = performance.now();
    issues = analyseMap(map, registry).issues;
    if (!selectionExists(selection)) selection = undefined;
    // Showing only mapped fields means the trees change with the links, not just the schemas.
    const mapped = mappedPaths();
    const schemas = JSON.stringify([level, map.source, map.target, options.mappedOnly ? [[...mapped.source], [...mapped.target]] : null]);
    if (schemas !== renderedSchemas) {
      renderedSchemas = schemas;
      renderTree(sourceTree, map.source, "source");
      renderTree(targetTree, map.target, "target");
    }
    renderBar();
    layout = options.autoLayout || searching() ? computeLayout() : undefined;
    renderNodes();
    renderPages();
    fitHeight();
    updateRows();
    applySelection();
    applyFailedNode();
    tell("issues", issues, (value) => options.onIssuesChange?.(structuredClone(value)));
    tell("page", [activePage(), level], () => options.onPageChange?.(activePage(), level));
    schedulePreview();
    if (phoneShown()) phone?.render();
    if (options.onPerformance) {
      // Lays it out now, as the browser would a moment later anyway, so the time includes it.
      void root.offsetHeight;
      options.onPerformance({ kind: "render", ms: performance.now() - started });
    }
  };

  /** Shows a state of the document at a level, falling back to the main map when that sub-map is gone. */
  const show = (next: MapDocument, nextLevel: string | undefined) => {
    doc = next;
    if (level !== nextLevel) {
      selection = undefined;
      page = undefined;
      traced = undefined;
    }
    level = nextLevel !== undefined && doc.submaps?.[nextLevel] ? nextLevel : undefined;
    map = levelOf(doc, level);
    refresh();
  };

  function showLevel(name: string | undefined) {
    show(doc, name);
    viewport.scrollTo(0, 0);
  }

  /** Applies an edit to the level being shown, and goes to `nextLevel` if given. */
  function commit(next: MapDocument, nextLevel = level) {
    commitDocument(withLevel(doc, level, next), nextLevel);
  }

  function commitDocument(next: MapDocument, nextLevel: string | undefined) {
    // Re-rendering the inspector drops focus from whatever was edited in it,
    // so keep it in the editor for Delete and undo.
    if (inspector.contains(document.activeElement) || bar.contains(document.activeElement)) root.focus({ preventScroll: true });
    undoStack.push({ doc, level });
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    show(next, nextLevel);
    options.onChange?.(structuredClone(doc));
  }

  const undo = () => {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push({ doc, level });
    show(previous.doc, previous.level);
    options.onChange?.(structuredClone(doc));
  };

  const redo = () => {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push({ doc, level });
    show(next.doc, next.level);
    options.onChange?.(structuredClone(doc));
  };

  // ---- sub-maps ----

  /** Switches between the main map and its sub-maps. Only there once the document has a sub-map. */
  function renderBar() {
    const names = Object.keys(doc.submaps ?? {});
    bar.hidden = names.length === 0;
    if (bar.hidden) return bar.replaceChildren();
    const picker = h("select", { "aria-label": t.showing });
    picker.append(new Option(t.mainMap, "", false, level === undefined));
    for (const name of names) picker.append(new Option(t.subMap(name), name, false, name === level));
    picker.addEventListener("change", () => showLevel(picker.value === "" ? undefined : picker.value));
    const uses = level === undefined ? 0 : [doc, ...Object.values(doc.submaps ?? {})].flatMap((m) => m.links).filter((l) => l.submap === level).length;
    bar.replaceChildren(
      ...([
        h("span", { class: "cw-bar-label" }, t.showing),
        picker,
        level !== undefined && h("span", { class: "cw-bar-note" }, t.subMapNote(map.source.title ?? t.record, map.target.title ?? t.record, uses)),
        level !== undefined && !readOnly && textButton(t.deleteSubMap, () => commitDocument(edits.removeSubmap(doc, level!), undefined)),
      ].filter((c): c is HTMLElement => Boolean(c))),
    );
  }

  function deleteSelection() {
    const current = selection;
    if (!current) return;
    selection = undefined;
    if (current.kind === "node") commit(edits.removeNode(map, current.id));
    else if (current.kind === "nodes") commit(edits.removeNodes(map, current.ids));
    else if (current.kind === "link") commit(edits.removeLink(map, current.index));
    else commit(edits.removeLoop(map, current.target));
  }

  // ---- dragging ----

  const pointerInGrid = (event: PointerEvent): Point => {
    const frame = grid.getBoundingClientRect();
    return { x: event.clientX - frame.left, y: event.clientY - frame.top };
  };

  /** Follows the pointer until it's released. `onMove` gets the distance moved from the start. */
  // Whether a drag is underway, which holds the highlight still: otherwise each row or operator the pointer
  // crosses would flash every line between dimmed and full strength.
  let tracking = false;
  const track = (start: PointerEvent, onMove: (event: PointerEvent, moved: boolean) => void, onUp: (event: PointerEvent, moved: boolean) => void) => {
    let moved = false;
    tracking = true;
    const move = (event: PointerEvent) => {
      if (!moved && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 4) return;
      moved = true;
      onMove(event, moved);
    };
    const up = (event: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      tracking = false;
      onUp(event, moved);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** Moves the operators selected with this one, together, as one edit. */
  const startGroupMove = (start: PointerEvent, ids: string[]) => {
    const origins = new Map(ids.flatMap((id) => {
      const element = nodeElements.get(id);
      return element ? [[id, { x: element.offsetLeft, y: element.offsetTop }] as const] : [];
    }));
    const positions = new Map(origins);
    track(
      start,
      (event) => {
        // The whole group stops at the grid's top and left edges together.
        const dx = Math.max((event.clientX - start.clientX) / zoom, -Math.min(...[...origins.values()].map((o) => o.x)));
        const dy = Math.max((event.clientY - start.clientY) / zoom, -Math.min(...[...origins.values()].map((o) => o.y)));
        for (const [id, origin] of origins) {
          const position = { x: origin.x + dx, y: origin.y + dy };
          positions.set(id, position);
          const element = nodeElements.get(id)!;
          element.style.left = `${position.x}px`;
          element.style.top = `${position.y}px`;
        }
        showPageDrop(event);
        scheduleDraw();
      },
      (event, moved) => {
        if (!moved) return;
        // Dropped on a page's tab, they go to that page, where they were.
        if (!dropOnPage(event, movingIds(ids))) commit(edits.moveNodes(map, positions));
      },
    );
  };

  const startMove = (start: PointerEvent, id: string, kind: "node" | "note" = "node") => {
    if (kind === "node" && selectedIds().length > 1 && selectedIds().includes(id)) return startGroupMove(start, selectedIds());
    const element = (kind === "node" ? nodeElements : noteElements).get(id);
    if (!element) return;
    const origin = { x: element.offsetLeft, y: element.offsetTop };
    let position = origin;
    if (kind === "note") {
      draggingNote = id;
      // Lets the pointer see what's under the note, to pin it there.
      element.classList.add("cw-moving");
    }
    track(
      start,
      (event) => {
        if (kind === "note") showPinTarget(event);
        position = {
          x: Math.max(0, origin.x + (event.clientX - start.clientX) / zoom),
          y: Math.max(0, origin.y + (event.clientY - start.clientY) / zoom),
        };
        element.style.left = `${position.x}px`;
        element.style.top = `${position.y}px`;
        if (kind === "node" || !map.notes?.find((n) => n.id === id)?.on) showPageDrop(event);
        scheduleDraw();
      },
      (event, moved) => {
        if (kind === "node") {
          // A click opens the operator's inspector; a drag only moves it, or, dropped on a page's tab, sends it there.
          if (moved && !dropOnPage(event, movingIds([id]))) commit(edits.moveNode(map, id, position));
          else if (!moved) select({ kind: "node", id });
          return;
        }
        if (moved && !map.notes?.find((n) => n.id === id)?.on && pageTabAt(event)) {
          draggingNote = undefined;
          element.classList.remove("cw-moving");
          clearPinTarget();
          if (dropOnPage(event, movingIds([id]))) return;
        }
        // Asked while the note still lets the pointer through to what's under it.
        const over = moved ? anchorAt(event) : undefined;
        draggingNote = undefined;
        element.classList.remove("cw-moving");
        clearPinTarget();
        if (!moved) return scheduleDraw();
        // Dropped on something, it's pinned there; dropped on the grid, it keeps what it was on.
        const was = map.notes?.find((n) => n.id === id)?.on;
        const placed = notePlacement(position, over ?? was, over !== undefined && JSON.stringify(over) !== JSON.stringify(was));
        commit(edits.placeNote(map, id, placed.position, placed.on));
      },
    );
  };

  /** Picks out what a dragged note would be pinned to. */
  let pinTarget: Element | undefined;
  const clearPinTarget = () => {
    pinTarget?.classList.remove("cw-drop-ok");
    pinTarget = undefined;
  };
  const showPinTarget = (event: PointerEvent) => {
    const on = anchorAt(event);
    const next = !on
      ? undefined
      : "node" in on
        ? nodeElements.get(on.node)
        : "target" in on
          ? targetRows.get(on.target)
          : sourceRows.get(on.source);
    if (next === pinTarget) return;
    clearPinTarget();
    pinTarget = next;
    pinTarget?.classList.add("cw-drop-ok");
  };

  const dropTargetAt = (event: PointerEvent): { element: HTMLElement; target: DropTarget } | undefined => {
    const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-drop]");
    if (!element || !root.contains(element)) return undefined;
    if (element.dataset.drop === "node") return { element, target: { kind: "node", id: element.dataset.id ?? "" } };
    return {
      element,
      target: {
        kind: "target",
        path: element.dataset.path ?? "",
        repeating: element.dataset.repeating === "true",
        value: element.dataset.value === "true",
      },
    };
  };

  const startLink = (start: PointerEvent, origin: DragOrigin) => {
    const from: (frame: DOMRect) => Point | undefined =
      origin.kind === "source" ? (frame) => rowAnchor("source", origin.path, frame) : (frame) => nodeAnchor(origin.id, "out", frame);
    let hovered: HTMLElement | undefined;
    let result: MapDocument | undefined;
    const clearHover = () => hovered?.classList.remove("cw-drop-ok", "cw-drop-bad");
    track(
      start,
      (event) => {
        root.classList.add("cw-linking");
        dragLine = { from, to: pointerInGrid(event) };
        const drop = dropTargetAt(event);
        if (drop?.element !== hovered) {
          clearHover();
          hovered = drop?.element;
          result = drop ? edits.connect(map, origin, drop.target, registry) : undefined;
          hovered?.classList.add(result ? "cw-drop-ok" : "cw-drop-bad");
        }
        scheduleDraw();
      },
      (_event, moved) => {
        root.classList.remove("cw-linking");
        clearHover();
        dragLine = undefined;
        if (result) commit(edits.newLinesOnPage(map, result, activePage()));
        else if (!moved && origin.kind === "source") traceField({ kind: "source", path: origin.path });
        // A click on an operator's output dot selects the operator, as a click anywhere else on it does.
        // On a phone, a tap meant for a small tile often lands on its dot.
        else if (!moved && origin.kind === "node") select({ kind: "node", id: origin.id });
        else scheduleDraw();
      },
    );
  };

  /** Drags a chip from the toolbox to the grid, or, where `landsOutside` says so, onto something outside it. */
  const startToolboxDrag = (
    start: PointerEvent,
    chip: HTMLElement,
    add: (position: Position, drop?: PointerEvent) => void,
    landsOutside: (drop: PointerEvent) => boolean = () => false,
  ) => {
    const ghost = chip.cloneNode(true) as HTMLElement;
    ghost.classList.add("cw-ghost");
    const place = (event: PointerEvent) => {
      ghost.style.left = `${event.clientX - 13}px`;
      ghost.style.top = `${event.clientY - 13}px`;
    };
    track(
      start,
      (event) => {
        if (!ghost.isConnected) root.append(ghost);
        place(event);
      },
      (event, moved) => {
        ghost.remove();
        let position: Position;
        if (moved) {
          const area = viewport.getBoundingClientRect();
          const inside = event.clientX >= area.left && event.clientX <= area.right && event.clientY >= area.top && event.clientY <= area.bottom;
          if (!inside && !landsOutside(event)) return;
          const origin = surface.getBoundingClientRect();
          position = {
            x: Math.max(0, (event.clientX - origin.left) / zoom - nodeSize() / 2),
            y: Math.max(0, (event.clientY - origin.top) / zoom - nodeSize() / 2),
          };
        } else {
          // A click adds the operator in the middle of what's visible, nudged so repeats don't stack.
          const nudge = (map.nodes.length % 5) * 12;
          position = {
            x: (viewport.scrollLeft + viewport.clientWidth / 2) / zoom - nodeSize() / 2 + nudge,
            y: (viewport.scrollTop + viewport.clientHeight / 2) / zoom - nodeSize() / 2 + nudge,
          };
        }
        add(position, moved ? event : undefined);
      },
    );
  };

  /**
   * On a touch screen a finger scrolls as well as drags, so a touch waits to
   * see which it is. Lifted where it landed, it's a click; held still for a
   * moment, it's a press that drags; moved first, it scrolls and nothing else
   * happens. That goes for an operator's output dot too, since a finger meant
   * for its tile often lands on it. Form controls work as usual.
   *
   * On the grid the editor scrolls it itself, under the finger. The lines are
   * drawn in a layer over the grid rather than in it, so a finger on a line
   * wouldn't scroll the grid otherwise, and on a phone lines cover most of it.
   */
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (event.pointerType !== "touch") return pointerDown(event, event.target as Element);
    // A second finger while the first is still deciding is a pinch: neither finger does anything in the editor.
    if (endTouch) return endTouch();
    if (tracking) return;
    // A phone moves a touch onto the nearest thing it thinks is clickable, which on an operator is its output
    // dot, so a finger anywhere on a tile would only ever draw a line. What's under the finger is what it touched.
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const target = under && root.contains(under) ? under : (event.target as Element);
    if (target.closest(".cw-inspector, input, select, textarea, button")) return pointerDown(event, event.target as Element);
    waitForTouch(event, target);
  };

  const waitForTouch = (down: PointerEvent, target: Element) => {
    const onGrid =
      grid.contains(target) &&
      !target.closest(".cw-zoom, .cw-pages") &&
      (viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight);
    const from = { left: viewport.scrollLeft, top: viewport.scrollTop };
    let panning = false;
    touchPanning = onGrid;
    const done = () => {
      touchPanning = false;
      endTouch = undefined;
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", done);
    };
    const move = (event: PointerEvent) => {
      const dx = event.clientX - down.clientX;
      const dy = event.clientY - down.clientY;
      if (!panning && Math.hypot(dx, dy) <= TOUCH_SLOP) return;
      // Still for long enough, it's a press, even if a busy page hasn't run the timer yet.
      if (!panning && event.timeStamp - down.timeStamp >= TOUCH_HOLD_MS) {
        done();
        return pointerDown(down, target);
      }
      if (!onGrid) return done();
      panning = true;
      clearTimeout(timer);
      viewport.scrollLeft = from.left - dx;
      viewport.scrollTop = from.top - dy;
    };
    // A tap is a press and a release in one: the press starts whatever it would, and a release where it began ends it.
    const up = (event: PointerEvent) => {
      done();
      if (panning) return;
      pointerDown(down, target);
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId, pointerType: "touch" }));
    };
    const timer = setTimeout(() => {
      done();
      navigator.vibrate?.(10);
      pointerDown(down, target);
    }, TOUCH_HOLD_MS);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", done);
    endTouch = done;
  };

  let touchPanning = false;
  /** Ends the touch being waited on, when a second finger makes it a pinch. */
  let endTouch: (() => void) | undefined;

  const pointerDown = (event: PointerEvent, target: Element) => {
    if (readOnly) {
      // Clicking an operator keeps its lines picked out; nothing can be changed.
      const stub = target.closest<SVGElement>("[data-hit^='page:']")?.dataset.hit;
      if (stub) return showPage(stub.slice(5) || undefined);
      // A field is traced, as in the editor.
      const row = target.closest<HTMLElement>(".cw-row");
      if (row?.dataset.path && !target.closest("button")) return traceField({ kind: row.closest(".cw-source") ? "source" : "target", path: row.dataset.path });
      const id = target.closest<HTMLElement>(".cw-node")?.dataset.id;
      return select(id ? { kind: "node", id } : undefined);
    }
    // Leave form controls, and the inspector, to work as usual.
    if (target.closest(".cw-inspector, input, select, textarea, button")) return;
    root.focus({ preventScroll: true });

    const chip = target.closest<HTMLElement>(".cw-toolbox .cw-chip");
    const operator = chip?.dataset.operator;
    if (chip && operator) {
      event.preventDefault();
      return startToolboxDrag(event, chip, (position) => {
        const added = edits.addNode(map, operator, position);
        selection = { kind: "node", id: added.id };
        commit(onActivePage(added.document, [added.id]));
      });
    }
    if (chip?.dataset.noteChip !== undefined && chip) {
      event.preventDefault();
      return startToolboxDrag(event, chip, (position, drop) => {
        // Dropped on an operator, line or field, the new note is pinned to it.
        const on = drop && anchorAt(drop);
        const placed = notePlacement(position, on, on !== undefined);
        const added = edits.addNote(map, placed.position, placed.on);
        commit(onActivePage(added.document, [added.id]));
        noteElements.get(added.id)?.querySelector("textarea")?.focus();
      }, (drop) => anchorAt(drop) !== undefined);
    }
    const grip = target.closest<HTMLElement>(".cw-note-grip");
    const note = grip?.closest<HTMLElement>(".cw-note")?.dataset.note;
    if (note) {
      event.preventDefault();
      return startMove(event, note, "note");
    }
    const output = target.closest<HTMLElement>("[data-out]");
    if (output?.dataset.out) {
      event.preventDefault();
      return startLink(event, { kind: "node", id: output.dataset.out });
    }
    const node = target.closest<HTMLElement>(".cw-node");
    if (node?.dataset.id) {
      event.preventDefault();
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        const id = node.dataset.id;
        const ids = selectedIds().includes(id) ? selectedIds().filter((other) => other !== id) : [...selectedIds(), id];
        return select(ids.length === 0 ? undefined : ids.length === 1 ? { kind: "node", id: ids[0]! } : { kind: "nodes", ids });
      }
      return startMove(event, node.dataset.id);
    }
    const row = target.closest<HTMLElement>(".cw-source .cw-row");
    if (row?.dataset.path) {
      event.preventDefault();
      return startLink(event, {
        kind: "source",
        path: row.dataset.path,
        repeating: row.dataset.repeating === "true",
        value: row.dataset.value === "true",
      });
    }
    const targetRow = target.closest<HTMLElement>(".cw-target .cw-row")?.dataset.path;
    if (targetRow !== undefined) return traceField({ kind: "target", path: targetRow });
    const hit = target.closest<SVGElement>("[data-hit]")?.dataset.hit;
    if (hit) {
      const [kind, ...rest] = hit.split(":");
      const value = rest.join(":");
      if (kind === "link" || kind === "loop") {
        const line: edits.PagedLine = kind === "link" ? { kind, index: Number(value) } : { kind, target: value };
        const link = line.kind === "link" ? map.links[line.index] : undefined;
        const submap = target.closest<SVGElement>("[data-submap]")?.dataset.submap;
        // The second click of a double-click on a sub-map's label opens it.
        if (pendingLine?.hit === hit) {
          clearTimeout(pendingLine.timer);
          pendingLine = undefined;
          if (submap !== undefined && doc.submaps?.[submap]) return showLevel(submap);
        }
        // A link to or from an operator goes where its operator goes, so only lines straight across drag.
        if (link && !("source" in link.from && "target" in link.to)) return select(line);
        event.preventDefault();
        return track(
          event,
          (move) => showPageDrop(move),
          (up, moved) => {
            if (moved) {
              if (!dropOnPage(up, (document, id) => edits.moveLineToPage(document, line, id))) select(line);
              return;
            }
            // Selected on release, since the inspector it opens can cover the line. A sub-map's label waits
            // a moment longer, in case it's double-clicked.
            if (submap === undefined) return select(line);
            pendingLine = { hit, timer: setTimeout(() => ((pendingLine = undefined), select(line)), 250) };
          },
        );
      }
      if (kind === "node") return select({ kind: "node", id: value });
      if (kind === "page") return showPage(value || undefined);
    }
    if (target.closest(".cw-viewport")) return startMarquee(event);
  };

  /** A sub-map's label just clicked, waiting to see if it's double-clicked before it's selected. */
  let pendingLine: { hit: string; timer: ReturnType<typeof setTimeout> } | undefined;

  /** Selects the operators a box drawn on empty grid touches. Shift adds them to what's selected. */
  const startMarquee = (start: PointerEvent) => {
    const before = start.shiftKey ? selectedIds() : [];
    const box = h("div", { class: "cw-marquee" });
    const frame = grid.getBoundingClientRect();
    let touched: string[] = [];
    track(
      start,
      (event) => {
        if (!box.isConnected) grid.append(box);
        const left = Math.min(start.clientX, event.clientX);
        const top = Math.min(start.clientY, event.clientY);
        const right = Math.max(start.clientX, event.clientX);
        const bottom = Math.max(start.clientY, event.clientY);
        Object.assign(box.style, { left: `${left - frame.left}px`, top: `${top - frame.top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
        touched = [...nodeElements].filter(([, element]) => {
          const r = element.getBoundingClientRect();
          return r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom;
        }).map(([id]) => id);
        const shown = new Set([...before, ...touched]);
        for (const [id, element] of nodeElements) element.classList.toggle("cw-selected", shown.has(id));
      },
      (_event, moved) => {
        box.remove();
        const ids = moved ? [...new Set([...before, ...touched])] : [];
        select(ids.length === 0 ? undefined : ids.length === 1 ? { kind: "node", id: ids[0]! } : { kind: "nodes", ids });
      },
    );
  };

  // ---- copy and paste ----

  // Each paste of the same copy lands a little further along, so they don't stack.
  let pastes = 0;

  const editingText = () => document.activeElement?.closest("input, textarea, select") !== null && document.activeElement !== root;

  const onCopy = (event: ClipboardEvent, cut: boolean) => {
    const ids = selectedIds();
    if (readOnly || editingText() || ids.length === 0 || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", JSON.stringify(edits.copyNodes(map, ids)));
    pastes = 0;
    if (cut) deleteSelection();
  };

  const onPaste = (event: ClipboardEvent) => {
    if (readOnly || editingText()) return;
    const fragment = edits.readFragment(event.clipboardData?.getData("text/plain") ?? "");
    if (!fragment) return;
    event.preventDefault();
    pastes++;
    const pasted = edits.pasteNodes(map, fragment, { x: 24 * pastes, y: 24 * pastes });
    selection = pasted.ids.length === 1 ? { kind: "node", id: pasted.ids[0]! } : { kind: "nodes", ids: pasted.ids };
    commit(onActivePage(pasted.document, pasted.ids));
  };

  const focusAt = (target: Element | null): Focus | undefined => {
    const node = target?.closest<HTMLElement>(".cw-node");
    if (node?.dataset.id) return { kind: "node", id: node.dataset.id };
    const row = target?.closest<HTMLElement>(".cw-row");
    if (row?.dataset.path) return { kind: row.closest(".cw-source") ? "source" : "target", path: row.dataset.path };
    return undefined;
  };

  const onPointerOver = (event: PointerEvent) => {
    if (dragLine || tracking) return;
    const next = focusAt(event.target as Element);
    if ((next && focusKeyOf(next)) === (hovered && focusKeyOf(hovered))) return;
    hovered = next;
    scheduleDraw();
  };

  const onPointerLeave = () => {
    if (!hovered || tracking) return;
    hovered = undefined;
    scheduleDraw();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as Element).closest("input, select, textarea")) return;
    if (readOnly) {
      if (event.key === "Escape") select(undefined);
      return;
    }
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (modifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (modifier && key === "y") {
      event.preventDefault();
      redo();
    } else if (modifier && key === "a" && pageNodes().length > 0) {
      event.preventDefault();
      const ids = pageNodes().map((n) => n.id);
      select(ids.length === 1 ? { kind: "node", id: ids[0]! } : { kind: "nodes", ids });
    } else if ((event.key === "Delete" || event.key === "Backspace") && selection) {
      event.preventDefault();
      deleteSelection();
    } else if (event.key === "Escape") {
      select(undefined);
    }
  };

  // Lines are drawn over the trees' and grid's own scrolling, so they're redrawn whenever any of it moves.
  root.addEventListener("pointerdown", onPointerDown);
  // While something's dragged by touch, or the grid is panned, the finger moves it rather than scrolling the page.
  root.addEventListener(
    "touchmove",
    (event) => {
      // Two fingers are a pinch, which the page zooms, so the editor lets it be.
      if (event.touches.length > 1) return endTouch?.();
      if (tracking || touchPanning) event.preventDefault();
    },
    { passive: false },
  );
  root.addEventListener("dblclick", (event) => {
    const name = (event.target as Element).closest<SVGElement>("[data-submap]")?.dataset.submap;
    if (name !== undefined && doc.submaps?.[name]) showLevel(name);
  });
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("copy", (event) => onCopy(event, false));
  root.addEventListener("cut", (event) => onCopy(event, true));
  root.addEventListener("paste", onPaste);
  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointerleave", onPointerLeave);
  sourceTree.addEventListener("scroll", scheduleDraw, { passive: true });
  targetTree.addEventListener("scroll", scheduleDraw, { passive: true });
  viewport.addEventListener("scroll", scheduleDraw, { passive: true });
  // Once the grid stops moving, the trees catch up with it.
  let followTimer: ReturnType<typeof setTimeout> | undefined;
  viewport.addEventListener(
    "scroll",
    () => {
      clearTimeout(followTimer);
      followTimer = setTimeout(followGrid, 150);
    },
    { passive: true },
  );
  viewport.addEventListener(
    "wheel",
    (event) => {
      if (options.fitContent || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const area = viewport.getBoundingClientRect();
      setZoom(zoom * Math.exp(-event.deltaY * 0.01), { x: event.clientX - area.left, y: event.clientY - area.top });
    },
    { passive: false },
  );
  // The list a phone shows in place of the canvas, unless the host keeps the canvas.
  const phone =
    options.phoneView === false
      ? undefined
      : createPhoneView({
          root,
          t,
          registry,
          readOnly,
          map: () => map,
          commit: (next) => commit(next),
          undo,
          input: () => previewInput,
          run: (next, signal) =>
            options.preview?.run
              ? options.preview.run({ map: next, input: previewInput ?? null }, { signal })
              : handlePreview({ map: next, input: previewInput ?? null }, { registry, signal }),
          operatorText,
          glyph: glyphOf,
          typeBadge,
        });
  if (phone) root.append(phone.element);
  const phoneShown = () => root.classList.contains("cw-phone");

  // An automatic layout centres its columns in the grid, so it follows the grid's width.
  const resizes = new ResizeObserver(() => {
    const onPhone = phone !== undefined && root.clientWidth < COMPACT;
    if (onPhone !== phoneShown()) {
      root.classList.toggle("cw-phone", onPhone);
      if (onPhone) phone!.render();
      fitHeight();
    }
    // A phone-sized editor gives the trees more of its width, and drops the type badges so names have the room.
    const compact = root.clientWidth < COMPACT;
    if (compact && !root.classList.contains("cw-compact")) revealOperators();
    root.classList.toggle("cw-compact", compact);
    fitPages();
    const narrow = root.clientWidth < NARROW;
    if (!toolboxChosen && !readOnly && narrow !== toolbox.classList.contains("cw-collapsed")) {
      setToolboxCollapsed(narrow);
      options.onToolboxToggle?.(narrow, true);
    }
    if (options.autoLayout || searching()) {
      layout = computeLayout();
      for (const [id, position] of layout) {
        const element = nodeElements.get(id);
        if (!element) continue;
        element.style.left = `${position.x}px`;
        element.style.top = `${position.y}px`;
      }
      placeNotes();
      fitHeight();
    }
    scheduleDraw();
  });
  resizes.observe(root);
  // Collapsing the toolbox resizes the grid without resizing the editor.
  resizes.observe(grid);

  refresh();
  revealPage();
  if (options.zoom !== undefined) setZoom(options.zoom, { x: 0, y: 0 });

  return {
    getDocument: () => structuredClone(doc),
    getSelection: publicSelection,
    setDocument(document) {
      if (JSON.stringify(document) === JSON.stringify(doc)) return;
      undoStack.push({ doc, level });
      redoStack.length = 0;
      show(structuredClone(document), level);
    },
    getIssues: () => [...issues],
    setPreviewInput(input) {
      previewInput = input;
      schedulePreview();
      if (phoneShown()) phone?.render();
    },
    setTheme(next) {
      theme = resolveTheme(next);
      applyTheme();
      scheduleDraw();
    },
    undo,
    redo,
    destroy() {
      clearTimeout(previewTimer);
      clearTimeout(followTimer);
      clearTimeout(pendingLine?.timer);
      previewRun?.abort();
      cancelAnimationFrame(frameRequest);
      resizes.disconnect();
      phone?.destroy();
      root.remove();
    },
  };
}
