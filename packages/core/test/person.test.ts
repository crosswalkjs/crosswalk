import { describe, expect, it } from "vitest";
import { analyseMap, createRegistry, createTransform, defineOperator, toText, type JsonValue, type MapDocument } from "../src/index.js";
import personMap from "./fixtures/person.map.json";
import personInput from "./fixtures/person.input.json";

// A host's own operator: the library has no date arithmetic, so the host supplies it.
const age = defineOperator({
  kind: "value",
  id: "example.age",
  label: "Age",
  category: "custom",
  inputs: { min: 1, max: 1 },
  run: ([dateOfBirth]) => {
    const today = new Date("2026-11-10T00:00:00Z");
    const born = new Date(`${toText(dateOfBirth ?? null)}T00:00:00Z`);
    const birthdayPassed =
      today.getUTCMonth() > born.getUTCMonth() ||
      (today.getUTCMonth() === born.getUTCMonth() && today.getUTCDate() >= born.getUTCDate());
    return today.getUTCFullYear() - born.getUTCFullYear() - (birthdayPassed ? 0 : 1);
  },
});

const registry = createRegistry({ operators: [age] });
const map = personMap as MapDocument;

describe("the Person map", () => {
  it("has no issues", () => {
    expect(analyseMap(map, registry).issues).toEqual([]);
  });

  it("maps a person to a profile", () => {
    const output = createTransform(map, { registry })(personInput);

    expect(output).toEqual({
      Address: "Rua das Flores 12, Porto",
      ZipCode: "4050",
      FullName: "Ana Silva",
      Age: 48,
      PhoneBilling: {
        TotalInternational: expect.closeTo(7.1) as number,
        TotalNational: 3.75,
      },
    });
  });

  it("leaves out a zip code that isn't numeric", () => {
    const output = createTransform(map, { registry })({ ...personInput, ZipCode: "N/A" }) as Record<string, JsonValue>;
    expect(output).not.toHaveProperty("ZipCode");
  });

  it("totals zero when there are no calls", () => {
    const output = createTransform(map, { registry })({ ...personInput, PhoneCalls: [] });
    expect(output).toMatchObject({ PhoneBilling: { TotalInternational: 0, TotalNational: 0 } });
  });

  it("leaves out fields whose source is missing", () => {
    const output = createTransform(map, { registry })({ FirstName: "Ana", LastName: "Silva" });
    expect(output).toEqual({ FullName: "Ana Silva", PhoneBilling: { TotalInternational: 0, TotalNational: 0 } });
  });
});
