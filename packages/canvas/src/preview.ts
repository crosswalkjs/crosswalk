import type { PreviewRequest, PreviewResponse } from "@crosswalkjs/core";

/** Runs a preview somewhere other than the browser, such as on your server. */
export type PreviewRunner = (request: PreviewRequest, options: { signal: AbortSignal }) => Promise<PreviewResponse>;

/**
 * A preview runner that posts `{ map, input }` to a URL and reads back the result.
 * The .NET runtime's `CrosswalkPreview.HandleAsync` and the JavaScript
 * `handlePreview` both answer in this shape.
 */
export function previewOverHttp(url: string, init: Omit<RequestInit, "method" | "body" | "signal"> = {}): PreviewRunner {
  return async (request, { signal }) => {
    const response = await fetch(url, {
      ...init,
      method: "POST",
      headers: { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) throw new Error(`The preview request failed: ${response.status} ${response.statusText}`.trim());
    return (await response.json()) as PreviewResponse;
  };
}
