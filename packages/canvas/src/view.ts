import type { MapDocument, OperatorRegistry } from "@crosswalkjs/core";
import { createMapper, type Mapper, type PreviewOptions } from "./mapper.js";
import type { Labels } from "./labels.js";
import type { ThemeDefinition } from "./themes.js";

export interface MapViewOptions {
  document: MapDocument;
  /** Needed to label your own operators. Defaults to the built-in operators. */
  registry?: OperatorRegistry;
  /** As for the editor. Defaults to `studio`. */
  theme?: string | ThemeDefinition;
  /** Shows every source and target field, not just the mapped ones. */
  showUnmapped?: boolean;
  /** Keeps operators where they were placed in the editor, rather than laying them out. */
  savedLayout?: boolean;
  /** Fills the container's height, rather than sizing to the content. */
  fillContainer?: boolean;
  /** Shows each target field's value for a sample input, as in the editor. */
  preview?: PreviewOptions;
  /** Draws each target field's line straight from the source fields it comes from, without the operators between. */
  hideOperators?: boolean;
  /** Closes up the space between the trees to just the lines. Hides operators and notes too. */
  hideGrid?: boolean;
  /** Hides the type badges beside field names. */
  hideTypes?: boolean;
  /** Hides notes. */
  hideNotes?: boolean;
  /** Hides the page tabs, and shows the whole map at once. */
  hidePages?: boolean;
  /** Hides the magnifier in each tree's heading that finds a field. */
  hideSearch?: boolean;
  /** As for the editor: its wording, in your words. */
  labels?: Partial<Labels>;
  /** As for the editor: how long it took to draw. */
  onPerformance?: (timing: { kind: "render" | "redraw"; ms: number }) => void;
}

export type MapView = Pick<Mapper, "getDocument" | "setDocument" | "setTheme" | "getIssues" | "setPreviewInput" | "destroy">;

/**
 * A read-only view of a map, in the editor's look: which fields map to which,
 * and through which operators. Shows only mapped fields, lays the operators
 * out between them, and sizes itself to fit, for a summary on a form or page.
 */
export function createMapView(element: HTMLElement, options: MapViewOptions): MapView {
  const { getDocument, setDocument, setTheme, getIssues, setPreviewInput, destroy } = createMapper(element, {
    document: options.document,
    ...(options.registry ? { registry: options.registry } : {}),
    ...(options.theme ? { theme: options.theme } : {}),
    readOnly: true,
    mappedOnly: !options.showUnmapped,
    autoLayout: !options.savedLayout,
    fitContent: !options.fillContainer,
    ...(options.preview ? { preview: options.preview } : {}),
    hideOperators: options.hideOperators ?? false,
    hideGrid: options.hideGrid ?? false,
    hideTypes: options.hideTypes ?? false,
    hideNotes: options.hideNotes ?? false,
    hidePages: options.hidePages ?? false,
    hideSearch: options.hideSearch ?? false,
    ...(options.onPerformance ? { onPerformance: options.onPerformance } : {}),
    ...(options.labels ? { labels: options.labels } : {}),
  });
  return { getDocument, setDocument, setTheme, getIssues, setPreviewInput, destroy };
}
