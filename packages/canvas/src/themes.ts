export type LinkStyle = "curved" | "straight" | "elbow";
export type GridStyle = "dots" | "lines" | "drafting" | "none";
export type Density = "compact" | "regular" | "roomy";

/** The sizes each density gives, in pixels: tree rows, operators on the grid, and chips in the toolbox. */
export const densities: Record<Density, { row: number; node: number; chip: number; glyph: number }> = {
  compact: { row: 22, node: 28, chip: 26, glyph: 12 },
  regular: { row: 26, node: 34, chip: 30, glyph: 13.5 },
  roomy: { row: 31, node: 40, chip: 34, glyph: 15 },
};

/** The editor's colours. Every one becomes a `--cw-*` custom property. */
export interface ThemeColors {
  background: string;
  panel: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  /** The grid's dots or lines. */
  grid: string;
  hover: string;
  link: string;
  accent: string;
  accentSoft: string;
  error: string;
  shadow: string;
  /** The tint of notes, mixed with `panel` for their background. */
  note: string;
}

/**
 * A look for the editor. Everything is optional except `id` and `label`: a
 * theme starts from the one it `extends` (Studio by default) and changes
 * only what it sets.
 */
export interface ThemeDefinition {
  /** Letters, digits, `-` and `_`, starting with a letter. */
  id: string;
  label: string;
  description?: string;
  /** Groups themes in a picker, such as "Editor themes". */
  group?: string;
  /** The theme to start from: a built-in or registered theme's id, or a definition. Defaults to `studio`. */
  extends?: string | ThemeDefinition;
  /**
   * `light` or `dark` fixes the scheme. `auto` follows the system, using
   * `darkColors` on top of `colors` when it's dark.
   */
  scheme?: "light" | "dark" | "auto";
  colors?: Partial<ThemeColors>;
  darkColors?: Partial<ThemeColors>;
  /** Operator tile colours, by category id. `"*"` sets every category, including ones a registry adds with its own colour. */
  categories?: Record<string, string>;
  /** The glyph colour on operator tiles. */
  glyph?: string;
  /** Glyph colours for particular categories, where a tile doesn't contrast with `glyph`. */
  glyphs?: Record<string, string>;
  /**
   * The tiles' outline. Left out, each tile is outlined a shade darker than itself; given, every tile is outlined in
   * it, a little heavier, so tiles the panel's colour with an ink outline read as outlined tiles.
   */
  tileBorder?: string;
  /** A shadow for every tile, as a CSS box-shadow, such as `2px 2px 0 #15171c` for a stamped look. Hover and selection rings add to it. */
  tileShadow?: string;
  fonts?: { ui?: string; glyph?: string; code?: string };
  shape?: { radius?: string; node?: string; chip?: string };
  links?: LinkStyle;
  linkWidth?: string;
  grid?: GridStyle;
  /** The grid's spacing in pixels. */
  gridSize?: number;
  /** How roomy the editor is: the height of tree rows, and the size of operators and toolbox chips. Text size is in `fonts.ui`. */
  density?: Density;
}

/** A theme with everything filled in from what it extends. */
export type ResolvedTheme = Required<Omit<ThemeDefinition, "extends" | "description" | "group" | "colors" | "darkColors" | "fonts" | "shape">> & {
  description: string;
  group: string;
  colors: ThemeColors;
  darkColors: Partial<ThemeColors>;
  fonts: { ui: string; glyph: string; code: string };
  shape: { radius: string; node: string; chip: string };
};

const SANS = `-apple-system, "Segoe UI", system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
const LIGHT_SHADOW = "0 1px 2px rgba(16, 24, 40, .06), 0 2px 8px rgba(16, 24, 40, .06)";
const DARK_SHADOW = "0 1px 2px rgba(0, 0, 0, .4), 0 2px 8px rgba(0, 0, 0, .3)";

const studio: ResolvedTheme = {
  id: "studio",
  label: "Studio",
  description: "Clean and neutral, with curved links. Follows light and dark mode.",
  group: "Crosswalk",
  scheme: "auto",
  colors: {
    background: "#f7f8fa",
    panel: "#ffffff",
    text: "#1d2433",
    muted: "#6b7486",
    faint: "#9aa2b1",
    border: "#e3e6ec",
    grid: "#d5d9e1",
    hover: "#f1f4f9",
    link: "#a3acbb",
    accent: "#3b6fd8",
    accentSoft: "#e3ecfc",
    error: "#d03b2a",
    shadow: LIGHT_SHADOW,
    note: "#f5d461",
  },
  darkColors: {
    background: "#111419",
    panel: "#181c23",
    text: "#e6e9ef",
    muted: "#99a2b2",
    faint: "#6b7383",
    border: "#272d37",
    grid: "#262c36",
    hover: "#1f242d",
    link: "#4f5868",
    accent: "#79a3ff",
    accentSoft: "#1b2a45",
    error: "#ff7b6e",
    shadow: DARK_SHADOW,
  },
  categories: {
    text: "#cf3f35",
    math: "#3566c4",
    logic: "#0f8278",
    date: "#d06c0c",
    convert: "#4f8a1b",
    aggregate: "#9c2346",
    flow: "#6d43b5",
    custom: "#b8870b",
  },
  glyph: "#ffffff",
  glyphs: {},
  tileBorder: "",
  tileShadow: "",
  fonts: { ui: `13px/1.4 ${SANS}`, glyph: "inherit", code: MONO },
  shape: { radius: "10px", node: "9px", chip: "7px" },
  links: "curved",
  linkWidth: "1.6px",
  grid: "dots",
  gridSize: 18,
  density: "regular",
};

/** Checks a theme definition and returns it. */
export function defineTheme(definition: ThemeDefinition): ThemeDefinition {
  if (!CSS_NAME.test(definition.id)) {
    throw new Error(`Theme id "${definition.id}" must start with a letter and use only letters, digits, - and _`);
  }
  checkCssValues(definition);
  return definition;
}

const CSS_NAME = /^[A-Za-z][\w-]*$/;

// Anything that could end a declaration or rule, start a comment, escape, or load something.
const UNSAFE_CSS = /[;{}<>\\]|\/\*|url\s*\(|@import|expression\s*\(/i;

/**
 * Theme values become CSS, and a theme can come from anywhere, such as a
 * customer's settings, so each must be a single value that can't end its
 * declaration or load anything.
 */
function checkCssValues(definition: ThemeDefinition): void {
  const where = `Theme "${definition.id}"`;
  const value = (name: string, text: unknown) => {
    if (text === undefined) return;
    if (typeof text !== "string" && typeof text !== "number") throw new Error(`${where}: ${name} must be text`);
    if (UNSAFE_CSS.test(String(text))) throw new Error(`${where}: ${name} isn't a single CSS value: ${JSON.stringify(text)}`);
  };
  const values = (name: string, record: Record<string, unknown> | undefined, keysAreClasses = false) => {
    for (const [key, text] of Object.entries(record ?? {})) {
      if (keysAreClasses && key !== "*" && !CSS_NAME.test(key)) throw new Error(`${where}: "${key}" in ${name} isn't a category id`);
      value(`${name}.${key}`, text);
    }
  };
  values("colors", definition.colors);
  values("darkColors", definition.darkColors);
  values("categories", definition.categories, true);
  values("glyphs", definition.glyphs, true);
  values("fonts", definition.fonts);
  values("shape", definition.shape);
  value("glyph", definition.glyph);
  value("tileBorder", definition.tileBorder);
  value("tileShadow", definition.tileShadow);
  value("linkWidth", definition.linkWidth);
  value("gridSize", definition.gridSize);
  if (definition.scheme !== undefined && !["light", "dark", "auto"].includes(definition.scheme)) throw new Error(`${where}: scheme must be light, dark or auto`);
  if (definition.links !== undefined && !["curved", "straight", "elbow"].includes(definition.links)) throw new Error(`${where}: links must be curved, straight or elbow`);
  if (definition.grid !== undefined && !["dots", "lines", "drafting", "none"].includes(definition.grid)) throw new Error(`${where}: grid must be dots, lines, drafting or none`);
  if (definition.density !== undefined && !Object.hasOwn(densities, definition.density)) throw new Error(`${where}: density must be compact, regular or roomy`);
}

/** Colours for an editor scheme with a fixed light or dark look. */
function scheme(
  dark: boolean,
  colors: Omit<ThemeColors, "shadow" | "note">,
  categories: Record<string, string>,
  glyph: string,
  glyphs: Record<string, string> = {},
): Pick<ThemeDefinition, "scheme" | "colors" | "categories" | "glyph" | "glyphs"> {
  return { scheme: dark ? "dark" : "light", colors: { ...colors, shadow: dark ? DARK_SHADOW : LIGHT_SHADOW }, categories, glyph, glyphs };
}

const SOLARIZED = {
  text: "#dc322f",
  math: "#268bd2",
  logic: "#2aa198",
  date: "#cb4b16",
  convert: "#859900",
  aggregate: "#d33682",
  flow: "#6c71c4",
  custom: "#b58900",
};

const builtins: ThemeDefinition[] = [
  // Ink first: it's the default.
  defineTheme({
    id: "ink",
    label: "Ink",
    description: "Ink on paper, as office paperwork: a plain page, lines in ink, and operators as highlighter-yellow tiles stamped in ink. Follows light and dark mode.",
    group: "Crosswalk",
    scheme: "auto",
    colors: {
      background: "#fafaf8",
      panel: "#fafaf8",
      text: "#15171c",
      muted: "#4a4d55",
      faint: "#94928b",
      border: "#deddd8",
      grid: "#deddd8",
      hover: "#f2f1ec",
      link: "#4a4d55",
      accent: "#15171c",
      accentSoft: "#ecebe6",
      error: "#15171c",
      shadow: "0 0 0 transparent",
      note: "#ffe066",
    },
    darkColors: {
      background: "#15171c",
      panel: "#15171c",
      text: "#f2f1ec",
      muted: "#b8b9bd",
      faint: "#7d7f86",
      border: "#34363d",
      grid: "#2a2c33",
      hover: "#1d1f25",
      link: "#b8b9bd",
      accent: "#f2f1ec",
      accentSoft: "#2a2c33",
      error: "#f2f1ec",
      shadow: "0 0 0 transparent",
    },
    // Operators are the one colour: highlighter-yellow tiles, outlined and stamped in ink like a printed sticker,
    // told apart by glyph and name. The stamp takes the text colour, so it shows on the dark page too.
    categories: Object.fromEntries(["*", "text", "math", "logic", "date", "convert", "aggregate", "flow", "custom"].map((c) => [c, "#ffe066"])),
    glyph: "#15171c",
    tileBorder: "#15171c",
    tileShadow: "2px 2px 0 var(--cw-text)",
    fonts: {
      ui: `14px/1.45 "Atkinson Hyperlegible Next", ${SANS}`,
      glyph: `"Atkinson Hyperlegible Next", ${SANS}`,
      code: `"Atkinson Hyperlegible Mono", ${MONO}`,
    },
    shape: { radius: "4px", node: "4px", chip: "4px" },
    linkWidth: "1.5px",
    grid: "none",
  }),
  studio,
  defineTheme({
    id: "classic",
    label: "Classic",
    description: "A traditional mapping tool: square tiles, straight lines and a ruled grid. Follows light and dark mode.",
    group: "Crosswalk",
    colors: {
      background: "#ffffff",
      panel: "#f6f7f9",
      text: "#1e1e1e",
      muted: "#555d6b",
      faint: "#8a919c",
      border: "#ccd2db",
      grid: "#e8ebf0",
      hover: "#e5eefb",
      link: "#3c4656",
      accent: "#1f5fbf",
      accentSoft: "#d6e4f8",
      error: "#c42b1c",
      shadow: "0 1px 1px rgba(0, 0, 0, .12)",
    },
    darkColors: {
      background: "#1e1e1e",
      panel: "#252526",
      text: "#d4d4d4",
      muted: "#a5a5a5",
      faint: "#7a7a7a",
      border: "#3c3c3c",
      grid: "#2b2b2b",
      hover: "#2a2d2e",
      link: "#c8c8c8",
      accent: "#3794ff",
      accentSoft: "#04395e",
      error: "#f48771",
      shadow: "0 1px 1px rgba(0, 0, 0, .4)",
    },
    fonts: { ui: `12.5px/1.35 "Segoe UI", Tahoma, ${SANS}` },
    shape: { radius: "3px", node: "3px", chip: "3px" },
    links: "straight",
    linkWidth: "1.25px",
    grid: "lines",
    gridSize: 16,
  }),
  defineTheme({
    id: "blueprint",
    label: "Blueprint",
    description: "Always dark: a drafting grid, right-angled links and monospace labels.",
    group: "Crosswalk",
    scheme: "dark",
    colors: {
      background: "#0e2645",
      panel: "#0a1d37",
      text: "#e2edfb",
      muted: "#a3bad8",
      faint: "#6e8cb3",
      border: "#20416b",
      grid: "rgba(125, 175, 255, .16)",
      hover: "#12315b",
      link: "#79aef7",
      accent: "#ffcf5c",
      accentSoft: "rgba(255, 207, 92, .16)",
      error: "#ff8a7a",
      shadow: "0 0 0 1px rgba(0, 0, 0, .25), 0 3px 10px rgba(0, 0, 0, .35)",
    },
    fonts: { ui: `12px/1.45 ${MONO}` },
    shape: { radius: "6px", node: "4px", chip: "4px" },
    links: "elbow",
    linkWidth: "1.5px",
    grid: "drafting",
    gridSize: 20,
  }),
  defineTheme({
    id: "paper",
    label: "Paper",
    description: "Always light: warm and quiet, with round tiles, no grid and a serif face.",
    group: "Crosswalk",
    scheme: "light",
    colors: {
      background: "#faf7f1",
      panel: "#fffdf8",
      text: "#2a251f",
      muted: "#776d60",
      faint: "#a59a8a",
      border: "#e9e1d3",
      grid: "transparent",
      hover: "#f4ede2",
      link: "#bfb3a1",
      accent: "#c2410c",
      accentSoft: "#fbe5d6",
      error: "#b42318",
      shadow: "0 1px 2px rgba(80, 60, 30, .10), 0 4px 12px rgba(80, 60, 30, .08)",
    },
    fonts: { ui: `13.5px/1.45 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`, glyph: SANS, code: SANS },
    shape: { radius: "14px", node: "50%", chip: "50%" },
    linkWidth: "1.3px",
    grid: "none",
  }),
  defineTheme({
    id: "github-light",
    label: "GitHub Light",
    description: "GitHub's light colours.",
    group: "Editor themes",
    ...scheme(
      false,
      {
        background: "#f6f8fa",
        panel: "#ffffff",
        text: "#1f2328",
        muted: "#59636e",
        faint: "#818b98",
        border: "#d1d9e0",
        grid: "#d8dee4",
        hover: "#eff2f5",
        link: "#8c959f",
        accent: "#0969da",
        accentSoft: "#ddf4ff",
        error: "#d1242f",
      },
      { text: "#cf222e", math: "#0969da", logic: "#1b7c83", date: "#bc4c00", convert: "#1a7f37", aggregate: "#bf3989", flow: "#8250df", custom: "#9a6700" },
      "#ffffff",
    ),
  }),
  defineTheme({
    id: "solarized-light",
    label: "Solarized Light",
    description: "Ethan Schoonover's Solarized, light.",
    group: "Editor themes",
    ...scheme(
      false,
      {
        background: "#fdf6e3",
        panel: "#eee8d5",
        text: "#073642",
        muted: "#586e75",
        faint: "#93a1a1",
        border: "#e2dbc4",
        grid: "#e6dfc8",
        hover: "#e6dfc8",
        link: "#93a1a1",
        accent: "#268bd2",
        accentSoft: "#dbe7e4",
        error: "#dc322f",
      },
      SOLARIZED,
      "#fdf6e3",
      { logic: "#002b36", convert: "#002b36", custom: "#002b36" },
    ),
  }),
  defineTheme({
    id: "solarized-dark",
    label: "Solarized Dark",
    description: "Ethan Schoonover's Solarized, dark.",
    group: "Editor themes",
    ...scheme(
      true,
      {
        background: "#002b36",
        panel: "#073642",
        text: "#eee8d5",
        muted: "#93a1a1",
        faint: "#657b83",
        border: "#0f4654",
        grid: "#0a3c48",
        hover: "#0b404d",
        link: "#586e75",
        accent: "#268bd2",
        accentSoft: "rgba(38, 139, 210, .22)",
        error: "#dc322f",
      },
      SOLARIZED,
      "#fdf6e3",
      { logic: "#002b36", convert: "#002b36", custom: "#002b36" },
    ),
  }),
  defineTheme({
    id: "one-dark",
    label: "One Dark",
    description: "Atom's One Dark.",
    group: "Editor themes",
    ...scheme(
      true,
      {
        background: "#282c34",
        panel: "#21252b",
        text: "#d7dae0",
        muted: "#abb2bf",
        faint: "#5c6370",
        border: "#3a3f4b",
        grid: "#323842",
        hover: "#2c313a",
        link: "#4b5263",
        accent: "#61afef",
        accentSoft: "rgba(97, 175, 239, .18)",
        error: "#e06c75",
      },
      { text: "#e06c75", math: "#61afef", logic: "#56b6c2", date: "#d19a66", convert: "#98c379", aggregate: "#be5046", flow: "#c678dd", custom: "#e5c07b" },
      "#282c34",
      { aggregate: "#ffffff" },
    ),
  }),
  defineTheme({
    id: "dracula",
    label: "Dracula",
    description: "The Dracula colour scheme.",
    group: "Editor themes",
    ...scheme(
      true,
      {
        background: "#282a36",
        panel: "#21222c",
        text: "#f8f8f2",
        muted: "#c4c4d4",
        faint: "#6272a4",
        border: "#343746",
        grid: "#343746",
        hover: "#343746",
        link: "#6272a4",
        accent: "#bd93f9",
        accentSoft: "rgba(189, 147, 249, .2)",
        error: "#ff5555",
      },
      { text: "#ff5555", math: "#bd93f9", logic: "#50fa7b", date: "#ffb86c", convert: "#8be9fd", aggregate: "#ff79c6", flow: "#6272a4", custom: "#f1fa8c" },
      "#282a36",
      { flow: "#f8f8f2" },
    ),
  }),
  defineTheme({
    id: "nord",
    label: "Nord",
    description: "The Nord arctic palette.",
    group: "Editor themes",
    ...scheme(
      true,
      {
        background: "#2e3440",
        panel: "#3b4252",
        text: "#eceff4",
        muted: "#d8dee9",
        faint: "#7b88a1",
        border: "#434c5e",
        grid: "#3b4252",
        hover: "#434c5e",
        link: "#616e88",
        accent: "#88c0d0",
        accentSoft: "rgba(136, 192, 208, .18)",
        error: "#bf616a",
      },
      { text: "#bf616a", math: "#5e81ac", logic: "#8fbcbb", date: "#d08770", convert: "#a3be8c", aggregate: "#b48ead", flow: "#81a1c1", custom: "#ebcb8b" },
      "#2e3440",
      { text: "#eceff4", math: "#eceff4" },
    ),
  }),
  defineTheme({
    id: "gruvbox-dark",
    label: "Gruvbox Dark",
    description: "Gruvbox's retro dark colours.",
    group: "Editor themes",
    links: "straight",
    ...scheme(
      true,
      {
        background: "#282828",
        panel: "#32302f",
        text: "#ebdbb2",
        muted: "#bdae93",
        faint: "#7c6f64",
        border: "#3c3836",
        grid: "#3c3836",
        hover: "#3c3836",
        link: "#665c54",
        accent: "#fabd2f",
        accentSoft: "rgba(250, 189, 47, .16)",
        error: "#fb4934",
      },
      { text: "#fb4934", math: "#83a598", logic: "#8ec07c", date: "#fe8019", convert: "#b8bb26", aggregate: "#b16286", flow: "#d3869b", custom: "#fabd2f" },
      "#282828",
      { aggregate: "#fbf1c7" },
    ),
  }),
  defineTheme({
    id: "monokai",
    label: "Monokai",
    description: "The classic Monokai.",
    group: "Editor themes",
    ...scheme(
      true,
      {
        background: "#272822",
        panel: "#1e1f1c",
        text: "#f8f8f2",
        muted: "#cfcfc2",
        faint: "#75715e",
        border: "#3e3d32",
        grid: "#3e3d32",
        hover: "#3e3d32",
        link: "#75715e",
        accent: "#a6e22e",
        accentSoft: "rgba(166, 226, 46, .16)",
        error: "#f92672",
      },
      { text: "#f92672", math: "#66d9ef", logic: "#a6e22e", date: "#fc9867", convert: "#78dce8", aggregate: "#ae81ff", flow: "#fd971f", custom: "#e6db74" },
      "#272822",
    ),
  }),
  defineTheme({
    id: "tokyo-night",
    label: "Tokyo Night",
    description: "The Tokyo Night colours.",
    group: "Editor themes",
    ...scheme(
      true,
      {
        background: "#1a1b26",
        panel: "#16161e",
        text: "#c0caf5",
        muted: "#a9b1d6",
        faint: "#565f89",
        border: "#292e42",
        grid: "#232433",
        hover: "#292e42",
        link: "#414868",
        accent: "#7aa2f7",
        accentSoft: "rgba(122, 162, 247, .18)",
        error: "#f7768e",
      },
      { text: "#f7768e", math: "#7aa2f7", logic: "#73daca", date: "#ff9e64", convert: "#9ece6a", aggregate: "#ff007c", flow: "#bb9af7", custom: "#e0af68" },
      "#1a1b26",
      { aggregate: "#ffffff" },
    ),
  }),
];

const registered = new Map<string, ThemeDefinition>(builtins.map((theme) => [theme.id, theme]));

/** The built-in themes, in picker order. */
export const themes: readonly ThemeDefinition[] = builtins;

/** Makes a theme available by id, to `setTheme`, the `theme` option and other themes' `extends`. */
export function registerTheme(definition: ThemeDefinition): void {
  registered.set(definition.id, defineTheme(definition));
}

/** Every theme that can be picked by id: the built-ins, then registered ones. */
export function listThemes(): ThemeDefinition[] {
  return [...registered.values()];
}

/** Fills in a theme from what it extends, all the way back to Studio. */
export function resolveTheme(theme: string | ThemeDefinition, seen = new Set<string>()): ResolvedTheme {
  // A definition passed straight in hasn't been through registerTheme, so it's checked here.
  const definition = typeof theme === "string" ? registered.get(theme) : defineTheme(theme);
  if (!definition) throw new Error(`Unknown theme "${String(theme)}"`);
  if (definition === studio) return studio;
  if (seen.has(definition.id)) throw new Error(`Theme "${definition.id}" extends itself`);
  seen.add(definition.id);
  const base = resolveTheme(definition.extends ?? studio, seen);
  return {
    ...base,
    ...Object.fromEntries(Object.entries(definition).filter(([key, value]) => key !== "extends" && value !== undefined)),
    id: definition.id,
    label: definition.label,
    description: definition.description ?? "",
    group: definition.group ?? "Custom",
    colors: { ...base.colors, ...definition.colors },
    darkColors: { ...base.darkColors, ...definition.darkColors },
    categories: { ...base.categories, ...definition.categories },
    glyphs: { ...base.glyphs, ...definition.glyphs },
    fonts: { ...base.fonts, ...definition.fonts },
    shape: { ...base.shape, ...definition.shape },
  } as ResolvedTheme;
}

const COLOR_PROPERTIES: Record<keyof ThemeColors, string> = {
  background: "--cw-bg",
  panel: "--cw-panel",
  text: "--cw-text",
  muted: "--cw-muted",
  faint: "--cw-faint",
  border: "--cw-border",
  grid: "--cw-grid-dot",
  hover: "--cw-hover",
  link: "--cw-link",
  accent: "--cw-accent",
  accentSoft: "--cw-accent-soft",
  error: "--cw-error",
  shadow: "--cw-shadow",
  note: "--cw-note",
};

function gridProperties(style: GridStyle, size: number): string[] {
  const dot = "var(--cw-grid-dot)";
  const line = (angle: string, colour: string) => `linear-gradient(${angle}${colour} 1px, transparent 1px)`;
  if (style === "none") return ["--cw-grid-image: none;", `--cw-grid-size: ${size}px ${size}px;`];
  if (style === "lines") return [`--cw-grid-image: ${line("", dot)}, ${line("90deg, ", dot)};`, `--cw-grid-size: ${size}px ${size}px;`];
  if (style === "drafting") {
    const minor = `color-mix(in srgb, ${dot} 60%, transparent)`;
    return [
      `--cw-grid-image: ${line("", dot)}, ${line("90deg, ", dot)}, ${line("", minor)}, ${line("90deg, ", minor)};`,
      `--cw-grid-size: ${size * 5}px ${size * 5}px, ${size * 5}px ${size * 5}px, ${size}px ${size}px, ${size}px ${size}px;`,
    ];
  }
  return [`--cw-grid-image: radial-gradient(${dot} 1px, transparent 1.4px);`, `--cw-grid-size: ${size}px ${size}px;`];
}

const colorProperties = (colors: Partial<ThemeColors>) =>
  Object.entries(colors).map(([name, value]) => `${COLOR_PROPERTIES[name as keyof ThemeColors]}: ${value};`);

/** The CSS for a resolved theme, scoped to editors showing it. */
export function themeStyles(theme: ResolvedTheme): string {
  const scope = `.cw-root[data-cw-theme="${theme.id}"]`;
  const properties = [
    ...colorProperties(theme.colors),
    `--cw-font: ${theme.fonts.ui};`,
    `--cw-glyph-font: ${theme.fonts.glyph};`,
    `--cw-code-font: ${theme.fonts.code};`,
    `--cw-radius: ${theme.shape.radius};`,
    `--cw-node-radius: ${theme.shape.node};`,
    `--cw-chip-radius: ${theme.shape.chip};`,
    `--cw-link-width: ${theme.linkWidth};`,
    `--cw-node-fg: ${theme.glyph};`,
    ...(theme.tileBorder ? [`--cw-node-border: ${theme.tileBorder};`, "--cw-node-border-width: 1.5px;"] : []),
    ...(theme.tileShadow ? [`--cw-node-shadow: ${theme.tileShadow};`] : []),
    `--cw-row-height: ${densities[theme.density].row}px;`,
    `--cw-node-size: ${densities[theme.density].node}px;`,
    `--cw-chip-size: ${densities[theme.density].chip}px;`,
    `--cw-node-glyph-size: ${densities[theme.density].glyph}px;`,
    ...gridProperties(theme.grid, theme.gridSize),
    `color-scheme: ${theme.scheme === "auto" ? "light" : theme.scheme};`,
  ];
  const rules = [
    `${scope} {\n  ${properties.join("\n  ")}\n}`,
    // "*" is every category, including ones a registry adds with colours of their own; named ones still win.
    ...(theme.categories["*"] ? [`${scope} [class*="cw-cat-"] { --cw-node: ${theme.categories["*"]}; }`] : []),
    ...(theme.glyphs["*"] ? [`${scope} [class*="cw-cat-"] { --cw-node-fg: ${theme.glyphs["*"]}; }`] : []),
    ...Object.entries(theme.categories)
      .filter(([category]) => category !== "*")
      .map(([category, colour]) => `${scope} .cw-cat-${category} { --cw-node: ${colour}; }`),
    ...Object.entries(theme.glyphs)
      .filter(([category]) => category !== "*")
      .map(([category, colour]) => `${scope} .cw-cat-${category} { --cw-node-fg: ${colour}; }`),
  ];
  if (theme.scheme === "auto" && Object.keys(theme.darkColors).length > 0) {
    rules.push(`@media (prefers-color-scheme: dark) {\n  ${scope} {\n    ${[...colorProperties(theme.darkColors), "color-scheme: dark;"].join("\n    ")}\n  }\n}`);
  }
  return rules.join("\n");
}
