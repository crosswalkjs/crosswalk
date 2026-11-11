import { describe, expect, it } from "vitest";
import { analyseMap, createRegistry, type MapDocument, type NoteAnchor } from "@crosswalkjs/core";
import {
  addNode,
  addNote,
  addPage,
  connect,
  copyNodes,
  moveNodes,
  moveToPage,
  moveLineToPage,
  newLinesOnPage,
  pageOf,
  pasteNodes,
  readFragment,
  removeNodes,
  createSubmap,
  moveNote,
  nextFreeInput,
  placeNote,
  removeInput,
  removeLink,
  removeLoop,
  removeNode,
  removeNote,
  removePage,
  renamePage,
  removeSubmap,
  setConstant,
  setInputLink,
  setLoopOptions,
  setNoteText,
  setRecordLink,
  swapInputs,
} from "../src/edits.js";
import personMap from "../../core/test/fixtures/person.map.json";

const registry = createRegistry();
const { source, target } = personMap as MapDocument;
const empty: MapDocument = { version: 1, source, target, nodes: [], links: [] };

const value = (path: string) => ({ kind: "source" as const, path, repeating: false, value: true });
const field = (path: string) => ({ kind: "target" as const, path, repeating: false, value: true });

describe("building the Person map by dragging", () => {
  it("fills node inputs in the order they're linked", () => {
    let { document, id } = addNode(empty, "text.concat", { x: 100, y: 40 });
    expect(id).toBe("concat1");
    document = connect(document, value("FirstName"), { kind: "node", id }, registry)!;
    document = setConstant(document, id, nextFreeInput(document, id), " ");
    document = connect(document, value("LastName"), { kind: "node", id }, registry)!;
    document = connect(document, { kind: "node", id }, field("FullName"), registry)!;

    expect(document.nodes[0]?.constants).toEqual({ 1: " " });
    expect(document.links.map((l) => l.to)).toEqual([{ node: id, input: 0 }, { node: id, input: 2 }, { target: "FullName" }]);
    expect(analyseMap(document, registry).issues).toEqual([]);
  });

  it("makes a loop when a repeating record is dropped on a repeating record", () => {
    const calls: MapDocument = {
      ...empty,
      target: { type: "object", properties: { Calls: { type: "array", items: { type: "object", properties: { Cost: { type: "number" } } } } } },
    };
    const looped = connect(
      calls,
      { kind: "source", path: "PhoneCalls[]", repeating: true, value: false },
      { kind: "target", path: "Calls[]", repeating: true, value: false },
      registry,
    );
    expect(looped?.loops).toEqual([{ source: "PhoneCalls[]", target: "Calls[]" }]);
  });

  it("sets an aggregate operator's scope when a repeating record is dropped on it", () => {
    const { document, id } = addNode(empty, "aggregate.sum", { x: 0, y: 0 });
    const scoped = connect(document, { kind: "source", path: "PhoneCalls[]", repeating: true, value: false }, { kind: "node", id }, registry);
    expect(scoped?.nodes[0]?.scope).toBe("PhoneCalls[]");
  });

  it("replaces a target field's link rather than adding a second", () => {
    let document = connect(empty, value("FirstName"), field("FullName"), registry)!;
    document = connect(document, value("LastName"), field("FullName"), registry)!;
    expect(document.links).toEqual([{ from: { source: "LastName" }, to: { target: "FullName" } }]);
  });

  it("refuses links that would make a cycle or overfill a node", () => {
    let { document, id: a } = addNode(empty, "text.upper", { x: 0, y: 0 });
    let b: string;
    ({ document, id: b } = addNode(document, "text.lower", { x: 0, y: 0 }));
    document = connect(document, { kind: "node", id: a }, { kind: "node", id: b }, registry)!;
    expect(connect(document, { kind: "node", id: b }, { kind: "node", id: a }, registry)).toBeUndefined();
    expect(connect(document, value("FirstName"), { kind: "node", id: b }, registry)).toBeUndefined();
  });
});

describe("reordering", () => {
  it("swaps a link and a constant between inputs", () => {
    let { document, id } = addNode(empty, "text.concat", { x: 0, y: 0 });
    document = connect(document, value("FirstName"), { kind: "node", id }, registry)!;
    document = connect(document, value("LastName"), { kind: "node", id }, registry)!;
    document = setConstant(document, id, 2, " ");
    document = swapInputs(document, id, 1, 2);
    expect(document.nodes[0]?.constants).toEqual({ 1: " " });
    expect(document.links.find((l) => "source" in l.from && l.from.source === "LastName")?.to).toEqual({ node: id, input: 2 });
  });
});

describe("removing", () => {
  it("closes the gap when an input is removed", () => {
    const map = personMap as MapDocument;
    const without = removeInput(map, "fullName", 0);
    const node = without.nodes.find((n) => n.id === "fullName");
    expect(node?.constants).toEqual({ 0: " " });
    expect(without.links.filter((l) => "node" in l.to && l.to.node === "fullName").map((l) => l.to)).toEqual([
      { node: "fullName", input: 1 },
    ]);
  });

  it("removes a node with its links, and the inputs it fed", () => {
    const without = removeNode(personMap as MapDocument, "isNational");
    expect(without.nodes.some((n) => n.id === "isNational")).toBe(false);
    expect(without.links.some((l) => ("node" in l.from && l.from.node === "isNational") || ("node" in l.to && l.to.node === "isNational"))).toBe(false);
    // nationalCost lost its condition, so the cost moved down to input 0.
    expect(without.links.find((l) => "node" in l.to && l.to.node === "nationalCost")?.to).toEqual({ node: "nationalCost", input: 0 });
  });

  it("removes a link to a target field", () => {
    const map = personMap as MapDocument;
    const index = map.links.findIndex((l) => "target" in l.to && l.to.target === "Address");
    expect(removeLink(map, index).links).toHaveLength(map.links.length - 1);
  });
});

describe("records, loops, sub-maps and notes", () => {
  const address = (...fields: string[]) => ({ type: "object" as const, properties: Object.fromEntries(fields.map((f) => [f, { type: "string" as const }])) });
  const orders: MapDocument = {
    version: 1,
    source: {
      type: "object",
      properties: {
        Billing: address("Street", "City"),
        Lines: { type: "array", items: { type: "object", properties: { Sku: { type: "string" }, Date: { type: "string" } } } },
      },
    },
    target: {
      type: "object",
      properties: {
        BillTo: address("Line1", "Town"),
        Products: { type: "array", items: { type: "object", properties: { Sku: { type: "string" } } } },
      },
    },
    nodes: [],
    links: [],
  };
  const record = (path: string, repeating = false) => ({ kind: "source" as const, path, repeating, value: false });
  const into = (path: string, repeating = false) => ({ kind: "target" as const, path, repeating, value: false });

  it("links a record dropped on a record, copying it until it's given a sub-map", () => {
    const linked = connect(orders, record("Billing"), into("BillTo"), registry)!;
    expect(linked.links).toEqual([{ from: { source: "Billing" }, to: { target: "BillTo" } }]);
    // A record isn't a value, so it can't go to an operator or a field.
    expect(connect(orders, record("Billing"), field("BillTo.Town"), registry)).toBeUndefined();

    const created = createSubmap(linked, "Billing", "BillTo")!;
    expect(created.name).toBe("BillTo");
    expect(created.document.links).toEqual([{ from: { source: "Billing" }, to: { target: "BillTo" }, submap: "BillTo" }]);
    expect(created.document.submaps?.BillTo).toMatchObject({ source: { title: "Billing", properties: { Street: {}, City: {} } }, target: { title: "BillTo" } });
    expect(analyseMap(created.document, registry).issues).toEqual([]);

    // Removing the sub-map leaves its links copying.
    const removed = removeSubmap(created.document, "BillTo");
    expect(removed.submaps).toBeUndefined();
    expect(removed.links).toEqual([{ from: { source: "Billing" }, to: { target: "BillTo" } }]);
  });

  it("sets and clears loop options, and a loop takes its item mapping with it", () => {
    let map = connect(orders, record("Lines[]", true), into("Products[]", true), registry)!;
    map = setLoopOptions(map, "Products[]", { sortBy: [{ path: "Lines[].Date", descending: true }], groupBy: "Lines[].Sku", distinct: true });
    expect(map.loops).toEqual([{ source: "Lines[]", target: "Products[]", sortBy: [{ path: "Lines[].Date", descending: true }], groupBy: "Lines[].Sku", distinct: true }]);
    map = setLoopOptions(map, "Products[]", { sortBy: [], groupBy: undefined, distinct: false });
    expect(map.loops).toEqual([{ source: "Lines[]", target: "Products[]" }]);

    map = setRecordLink(map, "Lines[]", "Products[]", undefined);
    expect(removeLoop(map, "Products[]").links).toEqual([]);
  });

  it("adds, edits, moves and removes notes", () => {
    const added = addNote(orders, { x: 10.4, y: 20.6 });
    let map = setNoteText(added.document, added.id, "Check with finance");
    map = moveNote(map, added.id, { x: 50, y: 60 });
    expect(map.notes).toEqual([{ id: "note1", text: "Check with finance", position: { x: 50, y: 60 } }]);
    expect(removeNote(map, "note1").notes).toBeUndefined();
  });
});

describe("notes pinned to operators", () => {
  const pinned = (document: MapDocument, on: NoteAnchor) =>
    addNote(document, { x: 10, y: -40 }, on).document;

  it("follows an input as the inputs around it change", () => {
    const map = personMap as MapDocument;
    let document = pinned(map, { node: "fullName", input: 2 });
    document = removeInput(document, "fullName", 0);
    expect(document.notes?.[0]?.on).toEqual({ node: "fullName", input: 1 });
    document = swapInputs(document, "fullName", 0, 1);
    expect(document.notes?.[0]?.on).toEqual({ node: "fullName", input: 0 });
    // Removing the input it's on leaves it on the operator.
    document = removeInput(document, "fullName", 0);
    expect(document.notes?.[0]?.on).toEqual({ node: "fullName" });
  });

  it("stays where the operator was when the operator is deleted", () => {
    const map = personMap as MapDocument;
    const node = map.nodes.find((n) => n.id === "fullName")!;
    const document = removeNode(pinned(map, { node: "fullName" }), "fullName");
    expect(document.notes?.[0]).toEqual({ id: "note1", text: "", position: { x: node.position!.x + 17 + 10, y: node.position!.y + 17 - 40 } });
  });

  it("pins and unpins", () => {
    const added = addNote(personMap as MapDocument, { x: 5, y: 5 });
    const on = placeNote(added.document, added.id, { x: -20, y: 30 }, { target: "FullName" });
    expect(on.notes?.[0]).toMatchObject({ position: { x: -20, y: 30 }, on: { target: "FullName" } });
    expect(placeNote(on, added.id, { x: 300, y: 80 }, undefined).notes?.[0]).toEqual({ id: "note1", text: "", position: { x: 300, y: 80 } });
  });
});

describe("linking an input from the inspector", () => {
  it("links a source field to a chosen input, replacing a constant there", () => {
    let { document, id } = addNode(empty, "math.add", { x: 0, y: 0 });
    document = setConstant(document, id, 1, 5);
    document = setInputLink(document, id, 1, { source: "FirstName" })!;
    expect(document.nodes[0]?.constants).toBeUndefined();
    expect(document.links).toEqual([{ from: { source: "FirstName" }, to: { node: id, input: 1 } }]);
  });

  it("won't link operators into a loop", () => {
    let { document, id: a } = addNode(empty, "text.upper", { x: 0, y: 0 });
    const added = addNode(document, "text.lower", { x: 0, y: 0 });
    document = connect(added.document, { kind: "node", id: a }, { kind: "node", id: added.id }, registry)!;
    expect(setInputLink(document, a, 0, { node: added.id })).toBeUndefined();
    expect(setInputLink(document, a, 0, { node: a })).toBeUndefined();
  });
});

describe("several operators at once", () => {
  const map = personMap as MapDocument;

  it("copies operators with the links between them and from source fields, but not to target fields", () => {
    const fragment = copyNodes(map, ["prefix", "isNational"]);
    expect(fragment.nodes.map((n) => n.id)).toEqual(["prefix", "isNational"]);
    expect(fragment.links.map((l) => ["node" in l.from ? l.from.node : l.from.source, "node" in l.to ? l.to.node : l.to.target])).toEqual([
      ["PhoneCalls[].PhoneNumber", "prefix"],
      ["prefix", "isNational"],
    ]);
    expect(readFragment(JSON.stringify(fragment))).toEqual(fragment);
    expect(readFragment("not a fragment")).toBeUndefined();
  });

  it("pastes them with new ids, moved along, and leaves out fields the map doesn't have", () => {
    const fragment = copyNodes(map, ["prefix", "isNational"]);
    const pasted = pasteNodes(map, fragment, { x: 24, y: 24 });
    expect(pasted.ids).toEqual(["left1", "equal1"]);
    const prefix = map.nodes.find((n) => n.id === "prefix")!;
    expect(pasted.document.nodes.find((n) => n.id === "left1")?.position).toEqual({ x: prefix.position!.x + 24, y: prefix.position!.y + 24 });
    expect(pasted.document.links.filter((l) => "node" in l.to && pasted.ids.includes(l.to.node))).toHaveLength(2);

    const elsewhere = { ...empty, source: { type: "object" as const, properties: { Other: { type: "string" as const } } } };
    const into = pasteNodes(elsewhere, fragment, { x: 0, y: 0 });
    expect(into.document.links).toEqual([{ from: { node: "left1" }, to: { node: "equal1", input: 0 } }]);
  });

  it("moves and removes them as one edit", () => {
    const moved = moveNodes(map, new Map([["prefix", { x: 1, y: 2 }], ["isNational", { x: 3, y: 4 }]]));
    expect(moved.nodes.filter((n) => n.id === "prefix" || n.id === "isNational").map((n) => n.position)).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    const removed = removeNodes(map, ["prefix", "isNational"]);
    expect(removed.nodes.some((n) => n.id === "prefix" || n.id === "isNational")).toBe(false);
  });
});

describe("pages", () => {
  const map = personMap as MapDocument;

  it("splits a map without pages into a first page with everything on it, and the new one", () => {
    const added = addPage(map);
    expect(added.document.pages).toEqual([{ id: "page1", name: "Page 1" }, { id: "page2", name: "Page 2" }]);
    expect(added.id).toBe("page2");
    expect(added.document.nodes.every((n) => pageOf(added.document, n) === "page1")).toBe(true);
    expect(pageOf(map, map.nodes[0]!)).toBeUndefined();
  });

  it("moves operators between pages and renames them", () => {
    const { document, id } = addPage(map);
    const moved = renamePage(moveToPage(document, ["prefix", "isNational"], id), id, "  Calls ");
    expect(moved.nodes.filter((n) => pageOf(moved, n) === id).map((n) => n.id)).toEqual(["prefix", "isNational"]);
    expect(moved.pages![1]!.name).toBe("Calls");
    expect(renamePage(moved, id, " ").pages![1]!.name).toBe("Calls");
    expect(moveToPage(moved, ["prefix"], "nowhere")).toBe(moved);
    // A page that isn't listed counts as the first.
    expect(pageOf(moved, { page: "nowhere" })).toBe("page1");
  });

  it("hands a removed page's operators and notes to the page before it, and keeps the last page's name", () => {
    let document = addPage(addPage(map).document).document;
    document = moveToPage(document, ["prefix"], "page2");
    document = moveToPage(document, ["isNational"], "page3");
    const two = removePage(document, "page3");
    expect(two.pages!.map((p) => p.id)).toEqual(["page1", "page2"]);
    expect(two.nodes.find((n) => n.id === "isNational")!.page).toBe("page2");

    const firstGone = removePage(two, "page1");
    expect(firstGone.pages).toEqual([{ id: "page2", name: "Page 2" }]);
    expect(firstGone.nodes.some((n) => "page" in n)).toBe(false);
  });

  it("moves links straight across, and loops, and puts new ones on the page they're made on", () => {
    const added = addPage(map).document;
    // The Person map has no loop, so one stands in.
    const document = { ...added, loops: [{ source: "PhoneCalls[]", target: "Calls[]" }] };
    const straight = document.links.findIndex((l) => "source" in l.from && "target" in l.to);
    const loop = "Calls[]";
    let moved = moveLineToPage(document, { kind: "link", index: straight }, "page2");
    moved = moveLineToPage(moved, { kind: "loop", target: loop }, "page2");
    expect(pageOf(moved, moved.links[straight]!)).toBe("page2");
    expect(pageOf(moved, moved.loops![0]!)).toBe("page2");
    expect(removePage(moved, "page2").links[straight]!.page).toBeUndefined();

    const linked = connect(document, value("LastName"), field("CivilStatus"), registry)!;
    const placed = newLinesOnPage(document, linked, "page2");
    expect(placed.links.filter((l) => l.page === "page2")).toHaveLength(1);
    expect(newLinesOnPage(document, linked, "page1")).toBe(linked);
  });

  it("leaves what the map does alone", () => {
    const { document } = addPage(map);
    const moved = moveToPage(document, ["prefix"], "page2");
    expect(analyseMap(moved, registry).issues).toEqual(analyseMap(map, registry).issues);
  });
});
