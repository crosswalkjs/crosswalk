// Builds the page a sandbox runs in: the reader's files, the two Crosswalk
// packages, and a stand-in for a server, all inline. The page runs in an iframe
// with only `allow-scripts`, so it has an opaque origin and can't reach the
// docs page, its cookies or its storage.

export interface Packages {
  core: string;
  canvas: string;
}

export interface PageOptions {
  /** Ties the page's messages to one run, so a slow old run can't write into a new console. */
  run: number;
  /** The docs page's own colours, so the preview sits in the page rather than on white. */
  background: string;
  color: string;
  /** So the browser doesn't paint a light page behind a dark one, or the other way round. */
  dark: boolean;
  /** What the page saved to localStorage in earlier runs, kept by the docs page. */
  storage: Record<string, string>;
}

/** What the page posts to the docs page: a console line, or what's now in its localStorage. */
export type SandboxMessage =
  | {crosswalkSandbox: number; level: 'log' | 'info' | 'warn' | 'error'; text: string; where?: string}
  | {crosswalkSandbox: number; storage: Record<string, string>};

/** Files under api/ aren't modules: the stand-in server answers requests for them, such as fetch("/api/theme.json"). */
export const isServed = (name: string) => name.startsWith('api/');

const MODULE = 'sandbox:';

const dataUrl = (code: string, name: string) =>
  `data:text/javascript;charset=utf-8,${encodeURIComponent(`${code}\n//# sourceURL=${name}`)}`;

/**
 * Modules load from data: URLs, which can't resolve `./crosswalk.js` relative
 * to themselves, so relative imports become names the import map knows. Only
 * the quoted specifier changes, so line numbers stay put.
 */
const linkImports = (code: string) =>
  code.replace(/(\b(?:from|import)\s*\(?\s*)(["'])\.\/([^"']+)\2/g, (_, before: string, quote: string, name: string) => `${before}${quote}${MODULE}${name}${quote}`);

/** A JSON file imports as its value, the way bundlers treat `import map from "./map.json"`. */
function jsonModule(text: string, name: string): string {
  try {
    return `export default ${JSON.stringify(JSON.parse(text))};`;
  } catch (error) {
    return `throw new SyntaxError(${JSON.stringify(`${name} isn't valid JSON: ${(error as Error).message}`)});`;
  }
}

/** The body: the example's index.html without its script tags (main.js runs anyway), or a single editor element. */
function bodyOf(html: string | undefined): string {
  if (html === undefined) return '<div id="mapper" style="height: 100vh"></div>';
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

// Runs before the reader's code: copies the console to the docs page, reports
// errors with the file and line they came from, and answers the two requests a
// Crosswalk server would, so the "from your server" examples work.
const prelude = (run: number, served: Record<string, string>, storage: Record<string, string>) => `
(() => {
  const send = (entry) => parent.postMessage({ crosswalkSandbox: ${run}, ...entry }, "*");
  const show = (value) => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.name + ": " + value.message;
    try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return String(value); }
  };
  const where = (error) => {
    const found = /(?:${MODULE})?([\\w.-]+\\.(?:js|json)):(\\d+)/.exec((error && error.stack) || "");
    return found ? found[1] + ":" + found[2] : undefined;
  };
  for (const level of ["log", "info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      send({ level, text: args.map(show).join(" "), where: args[0] instanceof Error ? where(args[0]) : undefined });
      original(...args);
    };
  }
  const tidy = (text) => String(text).replaceAll("${MODULE}", "./");
  addEventListener("error", (event) => send({ level: "error", text: tidy(event.message), where: where(event.error) }));
  addEventListener("unhandledrejection", (event) => send({ level: "error", text: "Uncaught (in promise) " + tidy(show(event.reason)), where: where(event.reason) }));

  // A stand-in for your server, with an operator of its own.
  let server;
  const serverRegistry = async () => {
    const core = await import("@crosswalkjs/core");
    server ??= core.createRegistry({
      categories: [core.defineCategory({ id: "acme", label: "Acme", color: "#ff3366" })],
      operators: [
        core.defineOperator({
          kind: "value",
          id: "acme.customerTier",
          label: "Customer tier",
          glyph: "tier",
          category: "acme",
          description: "Looks the customer up. This one runs on the server.",
          inputs: { min: 1, max: 1, labels: ["customer id"] },
          run: ([id]) => (/[02468]$/.test(core.toText(id ?? null)) ? "Gold" : "Silver"),
        }),
      ],
    });
    return { core, registry: server };
  };
  const json = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  const served = ${JSON.stringify(served).replaceAll('</', '<\\/')};

  // localStorage isn't available to a sandboxed page, so this stands in for it.
  // The docs page keeps what's saved, so it's still there after a rerun.
  const saved = new Map(Object.entries(${JSON.stringify(storage).replaceAll('</', '<\\/')}));
  const keep = () => send({ storage: Object.fromEntries(saved) });
  const storage = {
    getItem: (key) => (saved.has(String(key)) ? saved.get(String(key)) : null),
    setItem: (key, value) => { saved.set(String(key), String(value)); keep(); },
    removeItem: (key) => { saved.delete(String(key)); keep(); },
    clear: () => { saved.clear(); keep(); },
    key: (index) => [...saved.keys()][index] ?? null,
    get length() { return saved.size; },
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  const realFetch = fetch;
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, "https://example.com");
    if (url.pathname === "/crosswalk/operators") {
      const { registry } = await serverRegistry();
      send({ level: "info", text: "GET /crosswalk/operators, answered by the sandbox's stand-in server" });
      return json(registry.toCatalog());
    }
    if (url.pathname === "/crosswalk/preview") {
      const { core, registry } = await serverRegistry();
      return json(await core.handlePreview(JSON.parse(init.body), { registry }));
    }
    if (Object.hasOwn(served, url.pathname.slice(1))) {
      send({ level: "info", text: "GET " + url.pathname + ", answered by the sandbox's stand-in server" });
      return new Response(served[url.pathname.slice(1)], { headers: { "content-type": "application/json" } });
    }
    // The docs' example API: a customer's tier, after a moment, as a real lookup would take.
    const tier = url.host === "api.example.com" && /^\\/customers\\/([^/]+)\\/tier$/.exec(url.pathname);
    if (tier) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 400);
        init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(init.signal.reason); });
      });
      return json({ tier: /[02468]$/.test(decodeURIComponent(tier[1])) ? "Gold" : "Silver" });
    }
    return realFetch(input, init);
  };
})();
`;

/**
 * The canvas package as an example imports it: the real one, except that an editor made without a theme takes the
 * docs site's own, Ink, light or dark with the page. An example that picks a theme keeps it. The theme is passed as
 * a definition rather than registered, so it doesn't appear in an example's own list of themes.
 */
const canvasForExamples = (dark: boolean) => `import * as canvas from "crosswalk:canvas";
export * from "crosswalk:canvas";
const site = { id: "docs", label: "Ink", extends: "ink", scheme: "${dark ? 'dark' : 'light'}"${dark ? ', colors: canvas.resolveTheme("ink").darkColors' : ''} };
export function createMapper(element, options = {}) {
  return canvas.createMapper(element, { ...options, theme: options.theme ?? site });
}`;

/** The whole page for one run. */
export function buildPage(files: Record<string, string>, packages: Packages, options: PageOptions): string {
  const imports: Record<string, string> = {
    '@crosswalkjs/core': dataUrl(packages.core, 'crosswalk-core.js'),
    'crosswalk:canvas': dataUrl(packages.canvas, 'crosswalk-canvas.js'),
    '@crosswalkjs/canvas': dataUrl(canvasForExamples(options.dark), 'crosswalk-canvas-for-examples.js'),
  };
  const served: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) {
    if (isServed(name)) served[name] = text;
    else if (name.endsWith('.json')) imports[`${MODULE}${name}`] = dataUrl(jsonModule(text, name), name);
    else if (name.endsWith('.js')) imports[`${MODULE}${name}`] = dataUrl(linkImports(text), name);
  }
  // Inline scripts can't contain "</script>"; the import map's JSON escapes it.
  const map = JSON.stringify({imports}).replaceAll('</', '<\\/');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>:root { color-scheme: ${options.dark ? 'dark' : 'light'}; } html, body { margin: 0; min-height: 100%; background: ${options.background}; color: ${options.color}; font: 14px/1.5 system-ui, sans-serif; } pre { margin: 12px; white-space: pre-wrap; }</style>
<script type="importmap">${map}</script>
<script>${prelude(options.run, served, options.storage)}</script>
</head>
<body>
${bodyOf(files['index.html'])}
<script type="module">import "${MODULE}main.js";</script>
</body>
</html>`;
}
