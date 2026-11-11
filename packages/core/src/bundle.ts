import type { Schema } from "./types.js";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** What a JSON pointer fragment such as `/$defs/Address` points at; the empty fragment is the whole document. */
function pointer(document: unknown, fragment: string): unknown {
  if (fragment === "" || fragment === "/") return document;
  let at: unknown = document;
  for (const part of fragment.replace(/^\//, "").split("/")) {
    const key = decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~");
    at = isObject(at) && Object.hasOwn(at, key) ? at[key] : undefined;
  }
  return at;
}

/** A reference's address, made absolute against the document it's in, where that has an address. */
function resolve(ref: string, base: string | undefined): string {
  if (base === undefined) return ref;
  try {
    return new URL(ref, base).href;
  } catch {
    // Not a URL, such as a plain file path: resolve it as one.
    const folder = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
    return ref.startsWith("/") ? ref : `${folder}${ref}`;
  }
}

/**
 * The schema with every `$ref` to another file or URL brought in: what each
 * points at goes into `$defs`, under a name of its own, and the reference is
 * rewritten to point there. References inside the documents brought in are
 * followed too, relative to the document they're in. `load` fetches a
 * document by its address, once each: use `fetch`, read a file, or look it
 * up. The result needs nothing else, so either runtime can use it.
 *
 *     const schema = await bundleSchema(order, (url) => fetch(url).then((r) => r.json()), "https://example.com/schemas/order.json");
 */
export async function bundleSchema(schema: Schema, load: (address: string) => unknown | Promise<unknown>, address?: string): Promise<Schema> {
  const documents = new Map<string, Promise<unknown>>();
  const fetchOnce = (url: string) => {
    if (!documents.has(url)) documents.set(url, Promise.resolve(load(url)));
    return documents.get(url)!;
  };
  // Each document and fragment brought in, by address, and the $defs name it's under.
  const named = new Map<string, string>();
  const defs: Record<string, unknown> = {};
  const taken = new Set(Object.keys(schema.$defs ?? {}));
  const nameFor = (fragment: string, url: string) => {
    const last = fragment.split("/").filter(Boolean).pop() ?? url.split("/").pop()?.replace(/\.(schema\.)?json$/i, "") ?? "schema";
    const base = decodeURIComponent(last).replace(/[^A-Za-z0-9_.-]/g, "_") || "schema";
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
    taken.add(name);
    return name;
  };

  // Rewrites a part of a document at `url`; the root schema has no url unless one was given.
  const visit = async (value: unknown, url: string | undefined, inRoot: boolean): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map((item) => visit(item, url, inRoot)));
    if (!isObject(value)) return value;
    const out: Json = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key !== "$ref" || typeof inner !== "string") {
        out[key] = await visit(inner, url, inRoot);
        continue;
      }
      const hash = inner.indexOf("#");
      const file = hash === -1 ? inner : inner.slice(0, hash);
      const fragment = hash === -1 ? "" : inner.slice(hash + 1);
      // The root's own references stay as they are.
      if (file === "" && inRoot) {
        out.$ref = inner;
        continue;
      }
      const target = file === "" ? url! : resolve(file, url);
      const id = `${target}#${fragment}`;
      let name = named.get(id);
      if (name === undefined) {
        name = nameFor(fragment, target);
        named.set(id, name);
        // Its place is kept first, so $defs follow the order things are referred to.
        defs[name] = undefined;
        const document = await fetchOnce(target);
        const found = pointer(document, fragment);
        if (found === undefined) throw new Error(`"${inner}" points at nothing in ${target}`);
        defs[name] = await visit(found, target, false);
      }
      out.$ref = `#/$defs/${name}`;
    }
    return out;
  };

  const bundled = (await visit(schema, address, true)) as Schema;
  if (Object.keys(defs).length === 0) return bundled;
  return { ...bundled, $defs: { ...bundled.$defs, ...(defs as Record<string, Schema>) } };
}
