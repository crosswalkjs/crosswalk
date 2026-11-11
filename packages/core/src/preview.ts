import type { MapIssue } from "./analyse.js";
import type { OperatorRegistry } from "./operators/registry.js";
import { createAsyncTransform, limitsForUserMaps, MapLimitError, MapRuntimeError, MapValidationError, type RunLimits } from "./transform.js";
import type { JsonValue, MapDocument } from "./types.js";

/** What the editor sends to preview a map. */
export interface PreviewRequest {
  map: MapDocument;
  input: JsonValue;
}

/** A preview's result: the output, the map's errors, or the operator that failed. */
export type PreviewResponse =
  | { output: JsonValue }
  | { issues: MapIssue[] }
  | { error: { message: string; node?: string; limit?: keyof RunLimits } };

/**
 * Serves the editor's live preview from a JavaScript server, the same way the .NET
 * runtime's `CrosswalkPreview` does: runs the map in the request against its input.
 * A preview runs whatever someone has drawn, so `limitsForUserMaps` applies unless
 * you pass other `limits`.
 */
export async function handlePreview(
  request: PreviewRequest,
  options: { registry?: OperatorRegistry; signal?: AbortSignal; limits?: RunLimits } = {},
): Promise<PreviewResponse> {
  const { registry, signal, limits = limitsForUserMaps } = options;
  try {
    // Creating the transform checks the map's size before analysing it, so an oversized map costs nothing.
    const run = createAsyncTransform(request.map, { ...(registry ? { registry } : {}), limits });
    return { output: await run(request.input, signal ? { signal } : {}) };
  } catch (error) {
    if (error instanceof MapValidationError) return { issues: error.issues };
    if (error instanceof MapRuntimeError) return { error: { message: error.message, node: error.node } };
    if (error instanceof MapLimitError) return { error: { message: error.message, limit: error.limit, ...(error.node ? { node: error.node } : {}) } };
    throw error;
  }
}
