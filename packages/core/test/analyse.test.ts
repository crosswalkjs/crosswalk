import { describe, expect, it } from "vitest";
import { analyseMap, createRegistry, createTransform, MapRuntimeError, MapValidationError, type MapDocument } from "../src/index.js";
import personMap from "./fixtures/person.map.json";

const { source, target } = personMap as MapDocument;
const registry = createRegistry();

const codes = (document: Partial<MapDocument>) =>
  analyseMap({ version: 1, source, target, nodes: [], links: [], ...document }, registry).issues.map((issue) => issue.code);

describe("analyseMap", () => {
  it("rejects reading a repeating field into a single value", () => {
    expect(codes({ links: [{ from: { source: "PhoneCalls[].Cost" }, to: { target: "PhoneBilling.TotalNational" } }] })).toEqual([
      "unbound-scope",
    ]);
  });

  it("reports paths that aren't in the schemas", () => {
    expect(
      codes({
        links: [
          { from: { source: "Nickname" }, to: { target: "FullName" } },
          { from: { source: "FirstName" }, to: { target: "Nickname" } },
          { from: { source: "PhoneCalls" }, to: { target: "Address" } },
        ],
      }),
    ).toEqual(["unknown-source", "unknown-target", "unknown-source"]);
  });

  it("reports an unknown operator once", () => {
    expect(
      codes({
        nodes: [{ id: "x", operator: "text.reverse" }],
        links: [
          { from: { source: "FirstName" }, to: { node: "x", input: 0 } },
          { from: { node: "x" }, to: { target: "FullName" } },
        ],
      }),
    ).toEqual(["unknown-operator"]);
  });

  it("checks how many inputs an operator has", () => {
    expect(
      codes({
        nodes: [{ id: "gate", operator: "flow.onlyIf" }],
        links: [
          { from: { source: "FirstName" }, to: { node: "gate", input: 0 } },
          { from: { node: "gate" }, to: { target: "FullName" } },
        ],
      }),
    ).toEqual(["input-count"]);
  });

  it("finds gaps between inputs", () => {
    expect(
      codes({
        nodes: [{ id: "join", operator: "text.concat" }],
        links: [
          { from: { source: "FirstName" }, to: { node: "join", input: 0 } },
          { from: { source: "LastName" }, to: { node: "join", input: 2 } },
          { from: { node: "join" }, to: { target: "FullName" } },
        ],
      }),
    ).toEqual(["missing-input"]);
  });

  it("finds cycles", () => {
    expect(
      codes({
        nodes: [
          { id: "a", operator: "text.upper" },
          { id: "b", operator: "text.lower" },
        ],
        links: [
          { from: { node: "a" }, to: { node: "b", input: 0 } },
          { from: { node: "b" }, to: { node: "a", input: 0 } },
          { from: { node: "a" }, to: { target: "FullName" } },
        ],
      }),
    ).toEqual(["cycle"]);
  });

  it("needs a scope on aggregate operators", () => {
    expect(
      codes({
        nodes: [{ id: "sum", operator: "aggregate.sum" }],
        links: [
          { from: { source: "PhoneCalls[].Cost" }, to: { node: "sum", input: 0 } },
          { from: { node: "sum" }, to: { target: "PhoneBilling.TotalNational" } },
        ],
      }),
    ).toContain("scope-required");
  });

  it("needs a loop for a target array with mapped fields", () => {
    const issues = analyseMap(
      {
        version: 1,
        source,
        target: { type: "object", properties: { Numbers: { type: "array", items: { type: "string" } } } },
        nodes: [],
        links: [{ from: { source: "PhoneCalls[].PhoneNumber" }, to: { target: "Numbers[]" } }],
      },
      registry,
    ).issues;
    expect(issues.map((issue) => issue.code)).toEqual(["unbound-scope", "missing-loop"]);
  });

  it("warns about nodes that feed nothing", () => {
    const issues = analyseMap(
      { version: 1, source, target, nodes: [{ id: "spare", operator: "text.upper", constants: { 0: "x" } }], links: [] },
      registry,
    ).issues;
    expect(issues).toEqual([expect.objectContaining({ severity: "warning", code: "unused-node", node: "spare" })]);
  });
});

describe("createTransform", () => {
  it("throws every error at once", () => {
    const create = () =>
      createTransform({
        version: 1,
        source,
        target,
        nodes: [],
        links: [
          { from: { source: "Nickname" }, to: { target: "FullName" } },
          { from: { source: "PhoneCalls[].Cost" }, to: { target: "Address" } },
        ],
      });
    expect(create).toThrow(MapValidationError);
    expect(create).toThrow(/2 errors/);
  });

  it("names the node when an operator fails", () => {
    const run = createTransform({
      version: 1,
      source,
      target,
      nodes: [{ id: "double", operator: "math.multiply", constants: { 1: 2 } }],
      links: [
        { from: { source: "FirstName" }, to: { node: "double", input: 0 } },
        { from: { node: "double" }, to: { target: "Age" } },
      ],
    });
    expect(() => run({ FirstName: "Ana" })).toThrow(MapRuntimeError);
    expect(() => run({ FirstName: "Ana" })).toThrow(/"double" \(Multiply\) failed: Expected a number but got "Ana"/);
  });
});
