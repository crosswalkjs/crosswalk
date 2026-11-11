import type { Schema } from "./types.js";

/** A schema an OpenAPI document describes, ready to use as a map's source or target. */
export interface OpenApiSchema {
  /** Such as `POST /orders request`, `GET /orders/{id} response 200`, or a component's name. */
  name: string;
  kind: "request" | "response" | "component";
  /** The operation's summary, or the schema's description, if it has one. */
  description?: string;
  /** Self-contained: the document's other schemas come along as `$defs`, with their references rewritten to point there. */
  schema: Schema;
}

type Json = Record<string, unknown>;

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** What a JSON pointer such as `#/components/requestBodies/Order` points at in the document. */
function pointer(document: Json, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let at: unknown = document;
  for (const part of ref.slice(2).split("/")) {
    const key = decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~");
    at = isObject(at) && Object.hasOwn(at, key) ? at[key] : undefined;
  }
  return at;
}

/** Follows `$ref`s, such as a request body defined once under components, to what they point at. */
function follow(document: Json, value: unknown, seen = new Set<string>()): unknown {
  if (!isObject(value) || typeof value.$ref !== "string" || value.$ref.startsWith("#/components/schemas/") || value.$ref.startsWith("#/definitions/")) return value;
  if (seen.has(value.$ref)) return undefined;
  seen.add(value.$ref);
  return follow(document, pointer(document, value.$ref), seen);
}

/** A copy with every reference to a component schema pointing at `$defs` instead. */
function rewrite(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewrite);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      key === "$ref" && typeof inner === "string" && inner.startsWith("#/components/schemas/") ? `#/$defs/${inner.slice("#/components/schemas/".length)}` : rewrite(inner),
    ]),
  );
}

/** The JSON body's schema in an OpenAPI 3 `content` map: `application/json`, or failing that any JSON media type. */
function jsonBody(content: unknown): unknown {
  if (!isObject(content)) return undefined;
  const type = Object.hasOwn(content, "application/json") ? "application/json" : Object.keys(content).find((media) => /[/+]json\b/.test(media));
  const media = type ? content[type] : undefined;
  return isObject(media) ? media.schema : undefined;
}

/**
 * Every schema an OpenAPI document describes: each operation's JSON request
 * and response bodies, then its named component schemas. Works with OpenAPI
 * 3.0 and 3.1, and Swagger 2.0. Pick one by its `name` to map from or to:
 *
 *     const order = openApiSchemas(api).find((s) => s.name === "POST /orders request");
 */
export function openApiSchemas(document: unknown): OpenApiSchema[] {
  if (!isObject(document)) throw new Error("An OpenAPI document must be an object");
  const swagger = typeof document.swagger === "string";
  if (!swagger && typeof document.openapi !== "string") throw new Error('This isn\'t an OpenAPI document: it has neither "openapi" nor "swagger"');
  const components = swagger ? document.definitions : isObject(document.components) ? document.components.schemas : undefined;
  const definitions = isObject(components) ? (rewrite(components) as Record<string, Schema>) : {};
  // Swagger 2.0 refers to #/definitions/, which a schema reads as it is; OpenAPI 3 is rewritten to $defs.
  const withDefinitions = (schema: unknown): Schema => {
    const body = rewrite(schema) as Schema;
    if (Object.keys(definitions).length === 0) return body;
    return swagger ? { ...body, definitions } : { ...body, $defs: definitions };
  };

  const found: OpenApiSchema[] = [];
  for (const [path, item] of Object.entries(isObject(document.paths) ? document.paths : {})) {
    if (!isObject(item)) continue;
    for (const method of METHODS) {
      const operation = item[method];
      if (!isObject(operation)) continue;
      const label = `${method.toUpperCase()} ${path}`;
      const summary = typeof operation.summary === "string" ? { description: operation.summary } : {};
      const request = swagger
        ? (Array.isArray(operation.parameters) ? operation.parameters : []).map((p) => follow(document, p)).find((p) => isObject(p) && p.in === "body")
        : follow(document, operation.requestBody);
      const requestSchema = swagger ? (isObject(request) ? request.schema : undefined) : isObject(request) ? jsonBody(request.content) : undefined;
      if (isObject(requestSchema)) found.push({ name: `${label} request`, kind: "request", ...summary, schema: withDefinitions(requestSchema) });
      for (const [status, response] of Object.entries(isObject(operation.responses) ? operation.responses : {})) {
        const followed = follow(document, response);
        const responseSchema = swagger ? (isObject(followed) ? followed.schema : undefined) : isObject(followed) ? jsonBody(followed.content) : undefined;
        if (isObject(responseSchema)) found.push({ name: `${label} response ${status}`, kind: "response", ...summary, schema: withDefinitions(responseSchema) });
      }
    }
  }
  for (const [name, schema] of Object.entries(definitions)) {
    const description = typeof schema.description === "string" ? { description: schema.description } : {};
    found.push({ name, kind: "component", ...description, schema: withDefinitions({ $ref: swagger ? `#/definitions/${name}` : `#/$defs/${name}` }) });
  }
  return found;
}
