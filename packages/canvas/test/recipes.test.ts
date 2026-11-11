import { describe, expect, it } from "vitest";
import { analyseMap, createRegistry, createTransform, defineOperator, type MapDocument } from "@crosswalkjs/core";
import { clear, fill, place, probeMap, readProbe, recipeOf, repeatOf, sourcesOf, targetsByNode, type, unmap, valueAt } from "../src/recipes.js";
import personMap from "../../core/test/fixtures/person.map.json";
import personInput from "../../core/test/fixtures/person.input.json";

const map = personMap as MapDocument;
// The Person example's own operator, as the docs register it, with a fixed age so the tests don't date.
const registry = createRegistry({
  operators: [defineOperator({ kind: "value", id: "example.age", label: "Age", category: "text", inputs: { min: 1, max: 1 }, run: () => 48 })],
});
const errors = (document: MapDocument) => analyseMap(document, registry).issues.filter((issue) => issue.severity === "error");
const run = (document: MapDocument) => createTransform(document, { registry })(personInput);

describe("reading a map as recipes", () => {
  it("gives each target field the operators and source fields it's made from", () => {
    expect(recipeOf(map, registry, "FullName")).toEqual({
      kind: "node",
      id: "fullName",
      operator: "text.concat",
      scope: undefined,
      inputs: [{ kind: "source", path: "FirstName" }, { kind: "constant", value: " " }, { kind: "source", path: "LastName" }],
    });
    expect(recipeOf(map, registry, "Address")).toEqual({ kind: "source", path: "Address" });
    expect(recipeOf(map, registry, "CivilStatus")).toBeUndefined();
    expect(sourcesOf(recipeOf(map, registry, "PhoneBilling.TotalNational"))).toEqual(["PhoneCalls[].PhoneNumber", "PhoneCalls[].Cost"]);
  });

  it("knows which steps run once for each item, and which operators two fields share", () => {
    expect(repeatOf(map, registry, { node: "prefix" })).toBe("PhoneCalls[]");
    expect(repeatOf(map, registry, { node: "totalNational" })).toBeUndefined();
    expect(repeatOf(map, registry, { node: "fullName" })).toBeUndefined();
    expect(targetsByNode(map, registry).get("isNational")).toEqual(["PhoneBilling.TotalNational", "PhoneBilling.TotalInternational"]);
  });
});

describe("each step's value", () => {
  it("comes from one run of the map, with a value for each item where a step repeats, in the items' places", () => {
    const probe = probeMap(map, registry);
    expect(errors(probe)).toEqual([]);
    const { output, steps } = readProbe(run(probe));
    expect(output).toEqual(run(map));
    expect(steps.get("fullName")).toEqual({ value: "Ana Silva" });
    expect(steps.get("prefix")).toEqual({ each: ["+351", "+441", "+351", "+155"] });
    expect(steps.get("nationalCost")).toEqual({ each: [2.5, undefined, 1.25, undefined] });
    expect(steps.get("totalNational")).toEqual({ value: 3.75 });
  });

  it("reads a field's value, or one for each item through a list", () => {
    expect(valueAt(personInput, "LastName")).toEqual({ value: "Silva" });
    expect(valueAt(personInput, "PhoneCalls[].Cost")).toEqual({ each: [2.5, 4, 1.25, 3.1] });
  });
});

describe("editing a recipe", () => {
  it("maps a field straight from a source field, and stops mapping one, taking its operators with it", () => {
    const copied = fill(map, registry, { target: "CivilStatus" }, { source: "LastName" })!;
    expect(run(copied)).toMatchObject({ CivilStatus: "Silva" });
    const gone = unmap(map, registry, "FullName");
    expect(gone.nodes.some((n) => n.id === "fullName")).toBe(false);
    expect(run(gone)).not.toHaveProperty("FullName");
    expect(errors(gone)).toEqual([]);
  });

  it("keeps an operator another field still uses", () => {
    const gone = unmap(map, registry, "PhoneBilling.TotalNational");
    expect(gone.nodes.some((n) => n.id === "totalNational")).toBe(false);
    expect(gone.nodes.some((n) => n.id === "isNational")).toBe(true);
    expect(run(gone)).toMatchObject({ PhoneBilling: { TotalInternational: 7.1 } });
  });

  it("types a value and swaps an input for a source field", () => {
    const dashed = type(map, registry, { node: "fullName", input: 1 }, "-");
    expect(run(dashed)).toMatchObject({ FullName: "Ana-Silva" });
    const swapped = fill(map, registry, { node: "fullName", input: 0 }, { source: "Address" })!;
    expect(run(swapped)).toMatchObject({ FullName: "Rua das Flores 12, Porto Silva" });
  });

  it("puts a new operator in an empty field, wraps one round a step, and swaps one for another", () => {
    const fresh = place(map, registry, { target: "CivilStatus" }, "text.upper", "fresh")!;
    const id = recipeOf(fresh, registry, "CivilStatus")!;
    expect(id).toMatchObject({ kind: "node", operator: "text.upper", inputs: [undefined] });
    const filled = fill(fresh, registry, { node: id.kind === "node" ? id.id : "", input: 0 }, { source: "LastName" })!;
    expect(run(filled)).toMatchObject({ CivilStatus: "SILVA" });

    const wrapped = place(map, registry, { target: "FullName" }, "text.upper", "wrap")!;
    expect(run(wrapped)).toMatchObject({ FullName: "ANA SILVA" });
    expect(wrapped.nodes.some((n) => n.id === "fullName")).toBe(true);

    const replaced = place(map, registry, { target: "PhoneBilling.TotalNational" }, "aggregate.max", "replace")!;
    expect(run(replaced)).toMatchObject({ PhoneBilling: { TotalNational: 2.5 } });
    expect(replaced.nodes.some((n) => n.id === "totalNational")).toBe(false);
    expect(errors(replaced)).toEqual([]);
  });

  it("takes an input out of an operator that takes any number, and empties one that has a fixed set", () => {
    const shorter = clear(map, registry, { node: "fullName", input: 1 });
    expect(run(shorter)).toMatchObject({ FullName: "AnaSilva" });
    const emptied = clear(map, registry, { node: "zipGate", input: 0 });
    expect(recipeOf(emptied, registry, "ZipCode")).toMatchObject({ inputs: [undefined, { kind: "source", path: "ZipCode" }] });
    expect(emptied.nodes.some((n) => n.id === "zipIsNumeric")).toBe(false);
  });

  it("gives a total its list from the first field in a list it's given", () => {
    const totalled = place(map, registry, { target: "CivilStatus" }, "aggregate.count", "fresh")!;
    const total = recipeOf(totalled, registry, "CivilStatus");
    const counted = fill(totalled, registry, { node: total?.kind === "node" ? total.id : "", input: 0 }, { source: "PhoneCalls[].Cost" })!;
    expect(counted.nodes.find((n) => n.operator === "aggregate.count")?.scope).toBe("PhoneCalls[]");
  });
});
