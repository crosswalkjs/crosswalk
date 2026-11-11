import { describe, expect, it } from "vitest";
import { analyseMap, builtinOperators, createRegistry, defineCategory, defineOperator, type MapDocument } from "../src/index.js";
import personMap from "./fixtures/person.map.json";

const shout = defineOperator({
  kind: "value",
  id: "acme.shout",
  label: "Shout",
  category: "acme",
  inputs: { min: 1, max: 1 },
  run: ([value]) => `${String(value)}!`,
});

describe("createRegistry", () => {
  it("includes every built-in operator by default", () => {
    expect(createRegistry().list()).toHaveLength(builtinOperators.length);
  });

  it("can leave the built-ins out, or keep only some", () => {
    expect(createRegistry({ builtins: false }).list()).toEqual([]);
    const noMath = createRegistry({ builtins: (operator) => operator.category !== "math" });
    expect(noMath.has("math.add")).toBe(false);
    expect(noMath.has("text.concat")).toBe(true);
    expect(noMath.categories().map((c) => c.id)).not.toContain("math");
  });

  it("adds your own operators and categories", () => {
    const registry = createRegistry({
      builtins: false,
      categories: [defineCategory({ id: "acme", label: "Acme", color: "#ff3366" })],
      operators: [shout],
    });
    expect(registry.categories()).toEqual([{ id: "acme", label: "Acme", color: "#ff3366" }]);
    expect(registry.get("acme.shout")?.label).toBe("Shout");
  });

  it("creates a category for an operator whose category isn't registered", () => {
    const registry = createRegistry({ builtins: false, operators: [shout] });
    expect(registry.getCategory("acme")).toEqual({ id: "acme", label: "acme" });
  });

  it("relabels a built-in category", () => {
    const registry = createRegistry({ categories: [{ id: "text", label: "Strings" }] });
    expect(registry.getCategory("text")?.label).toBe("Strings");
  });

  it("reports operators a map uses that were taken out", () => {
    const registry = createRegistry({ operators: [] }).unregister("text.concat");
    const issues = analyseMap(personMap as MapDocument, registry).issues.filter((i) => i.code === "unknown-operator");
    expect(issues.map((i) => i.node)).toEqual(["fullName", "age"]);
  });

  it("rejects category ids that can't be used as class names", () => {
    expect(() => defineCategory({ id: "my category", label: "Mine" })).toThrow(/must start with a letter/);
  });
});
