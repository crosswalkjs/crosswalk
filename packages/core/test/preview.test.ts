import { describe, expect, it } from "vitest";
import { handlePreview, type MapDocument } from "../src/index.js";
import personMap from "../../../conformance/maps/person-profile/map.json";
import personInput from "../../../conformance/maps/person-profile/input.json";

const map = personMap as MapDocument;

describe("handlePreview", () => {
  it("returns the output", async () => {
    expect(await handlePreview({ map, input: personInput })).toMatchObject({ output: { FullName: "Ana Silva" } });
  });

  it("returns the map's errors instead of running it", async () => {
    const broken: MapDocument = { ...map, links: [...map.links, { from: { source: "Nope" }, to: { target: "FullName" } }] };
    const response = await handlePreview({ map: broken, input: personInput });
    expect(response).toMatchObject({ issues: [{ code: "unknown-source" }] });
  });

  it("names the operator that fails on the input", async () => {
    const response = await handlePreview({ map, input: { ...personInput, PhoneCalls: [{ PhoneNumber: "+351", Cost: "lots" }] } });
    expect(response).toEqual({ error: { message: expect.stringMatching(/Expected a number/) as string, node: "totalNational" } });
  });
});
