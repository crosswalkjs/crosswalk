import { createRegistry, type MapDocument } from "@crosswalkjs/core";
import { createMapper, type Labels, type Mapper } from "@crosswalkjs/canvas";
import { blankPersonMap, personMap } from "../../website/src/examples/person";
import { orderMap } from "../../website/src/examples/order";
import { categories, operators } from "../../website/src/examples/operators";
import { buildMap as buildOrderToErp } from "../../website/src/examples/bigmap";

/**
 * A made-up map as big as `size` says: that many operators, each joining two
 * source fields into a target field, with every fifth fed by the one before.
 * The fields are in records of 20, with as many fields on each side as operators.
 */
function bigMap(size: number): MapDocument {
  const records = Math.ceil(size / 20);
  const side = (prefix: string) => ({
    type: "object" as const,
    title: prefix,
    properties: Object.fromEntries(
      Array.from({ length: records }, (_, r) => [
        `${prefix}${r}`,
        { type: "object" as const, properties: Object.fromEntries(Array.from({ length: 20 }, (_, f) => [`field${f}`, { type: "string" as const }])) },
      ]),
    ),
  });
  const field = (prefix: string, i: number) => `${prefix}${Math.floor(i / 20)}.field${i % 20}`;
  const nodes = Array.from({ length: size }, (_, i) => ({
    id: `op${i}`,
    operator: "text.concat",
    position: { x: 40 + (i % 12) * 90, y: 30 + Math.floor(i / 12) * 70 },
  }));
  const links = nodes.flatMap((node, i) => [
    { from: i % 5 === 4 ? { node: `op${i - 1}` } : { source: field("In", i) }, to: { node: node.id, input: 0 } },
    { from: { source: field("In", (i + 7) % size) }, to: { node: node.id, input: 1 } },
    { from: { node: node.id }, to: { target: field("Out", i) } },
  ]);
  return { version: 1, source: side("In"), target: side("Out"), nodes, links };
}

// The editor the tests drive. `?map=` picks the map, `?size=` makes a big one, and `?readOnly` makes it read-only.
const maps: Record<string, MapDocument> = { person: personMap, blank: blankPersonMap, order: orderMap };
const params = new URLSearchParams(location.search);
if (params.has("size")) maps.big = bigMap(Number(params.get("size")));
// The docs' order-to-ERP map; `?orders=` puts several side by side.
maps.erp = buildOrderToErp(Number(params.get("orders") ?? 1));
const changes: MapDocument[] = [];

// A few labels in French, for the tests of the wording.
const french: Partial<Labels> = {
  operators: "Opérateurs",
  findOperator: "Chercher un opérateur",
  close: "Fermer",
  deleteOperator: "Supprimer l'opérateur",
  inputLabel: (index) => `Entrée ${index + 1}`,
  operator: (definition) => (definition.id === "text.concat" ? { label: "Concaténer", description: "Met des textes bout à bout." } : { label: definition.label }),
  issue: (issue) => (issue.code === "input-count" ? "Il manque une entrée." : issue.message),
};

// Every event the editor sends, in order, for the tests to read.
const events: [string, unknown][] = [];

const started = performance.now();
const mapper = createMapper(document.getElementById("editor")!, {
  document: maps[params.get("map") ?? "person"]!,
  registry: createRegistry({ categories, operators }),
  readOnly: params.has("readOnly"),
  editSchemas: params.has("editSchemas"),
  toolboxCollapsed: false,
  onChange: (next) => changes.push(next),
  onSelectionChange: (selection) => events.push(["selection", selection]),
  onPageChange: (page, submap) => events.push(["page", { page, submap }]),
  onIssuesChange: (issues) => events.push(["issues", issues.length]),
  ...(params.get("labels") === "fr" ? { labels: french } : {}),
});

declare global {
  interface Window {
    editor: Mapper;
    changes: MapDocument[];
    events: [string, unknown][];
    loadTime: number;
  }
}
window.editor = mapper;
window.loadTime = performance.now() - started;
window.changes = changes;
window.events = events;
