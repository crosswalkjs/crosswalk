import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapDocument } from "@crosswalkjs/core";
import { previewOverHttp } from "../src/preview.js";

const map: MapDocument = { version: 1, source: { type: "object" }, target: { type: "object" }, nodes: [], links: [] };

describe("previewOverHttp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the map and input as JSON and reads back the result", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ output: { ok: true } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    const response = await previewOverHttp("/crosswalk/preview", { headers: { authorization: "Bearer x" } })({ map, input: { a: 1 } }, { signal });

    expect(response).toEqual({ output: { ok: true } });
    expect(fetch).toHaveBeenCalledWith("/crosswalk/preview", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer x" },
      body: JSON.stringify({ map, input: { a: 1 } }),
      signal,
    });
  });

  it("fails clearly when the server does", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500, statusText: "Internal Server Error" })));
    await expect(previewOverHttp("/p")({ map, input: {} }, { signal: new AbortController().signal })).rejects.toThrow(/500 Internal Server Error/);
  });
});
