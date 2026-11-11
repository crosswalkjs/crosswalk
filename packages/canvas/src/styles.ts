// Injected once per document: layout and structure only. Every class is
// prefixed `cw-`. Colours, fonts and shapes come from the active theme as
// `--cw-*` custom properties (see themes.ts).
export const styles = `
.cw-root {
  font: var(--cw-font);
  color: var(--cw-text);
  background: var(--cw-bg);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 360px;
  isolation: isolate;
  outline: none;
  border: 1px solid var(--cw-border);
  border-radius: var(--cw-radius);
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}
.cw-root *, .cw-root *::before, .cw-root *::after { box-sizing: border-box; }
.cw-root:focus-visible { box-shadow: 0 0 0 3px var(--cw-accent-soft); }
.cw-root.cw-linking, .cw-root.cw-linking * { cursor: crosshair !important; }

/* Operators: a solid tile in the category's colour (--cw-node), set by the theme, outlined a shade darker unless
   the theme gives an outline of its own (--cw-node-border), as for outlined tiles. */
.cw-chip, .cw-node {
  display: grid;
  place-items: center;
  background: var(--cw-node, #6b7280);
  border: var(--cw-node-border-width, 1px) solid var(--cw-node-border, color-mix(in srgb, var(--cw-node, #6b7280) 70%, #000));
  color: var(--cw-node-fg, #fff);
  font-family: var(--cw-glyph-font, inherit);
  font-weight: 650;
  white-space: nowrap;
  letter-spacing: -.02em;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .18);
}

.cw-toolbox {
  display: flex;
  flex-direction: column;
  width: 196px;
  min-height: 0;
  background: var(--cw-panel);
  border-right: 1px solid var(--cw-border);
}
.cw-toolbox-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 52px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--cw-border);
}
.cw-toolbox-title { font-weight: 600; }
.cw-toolbox .cw-toolbox-toggle { margin-left: auto; width: 22px; height: 22px; font-size: 14px; line-height: 22px; }
.cw-toolbox-search {
  flex: none;
  margin: 10px 10px 2px;
  padding: 5px 8px;
  border: 1px solid var(--cw-border);
  border-radius: 6px;
  background: var(--cw-bg);
  color: var(--cw-text);
  font: inherit;
  font-size: 12px;
}
.cw-toolbox-search:focus { outline: none; border-color: var(--cw-accent); box-shadow: 0 0 0 3px var(--cw-accent-soft); }
.cw-toolbox-list { flex: 1; min-height: 0; overflow: auto; padding: 0 10px 10px; scrollbar-width: thin; }
.cw-group { margin: 12px 0 6px; font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--cw-faint); }
.cw-chips { display: grid; grid-template-columns: repeat(auto-fill, var(--cw-chip-size, 30px)); gap: 5px; }
.cw-chip { width: var(--cw-chip-size, 30px); height: var(--cw-chip-size, 30px); border-radius: var(--cw-chip-radius); font-size: 12px; cursor: grab; transition: transform .08s, filter .08s; box-shadow: var(--cw-node-shadow, inset 0 1px 0 rgba(255, 255, 255, .18)); }
.cw-chip:hover { filter: brightness(1.1); transform: translateY(-1px); }
.cw-chip[hidden], .cw-section[hidden] { display: none; }
.cw-hint { flex: none; margin: 0; padding: 9px 12px; border-top: 1px solid var(--cw-border); font-size: 11.5px; line-height: 1.45; color: var(--cw-faint); }
.cw-toolbox-rail { display: none; }
.cw-toolbox.cw-collapsed { width: 38px; }
.cw-toolbox.cw-collapsed .cw-toolbox-head { justify-content: center; padding: 0; }
.cw-toolbox.cw-collapsed .cw-toolbox-toggle { margin: 0; }
.cw-toolbox.cw-collapsed :is(.cw-toolbox-title, .cw-toolbox-search, .cw-toolbox-list, .cw-hint) { display: none; }
.cw-toolbox.cw-collapsed .cw-toolbox-rail {
  display: block;
  margin: 12px auto;
  writing-mode: vertical-rl;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--cw-faint);
}

.cw-body {
  flex: 1;
  min-height: 0;
  display: grid;
  /* Small minimums, so the editor fits a narrow column; names shorten with "…" before anything is cut off. */
  grid-template-columns: auto minmax(96px, 1fr) minmax(140px, 2fr) minmax(96px, 1fr);
}

/* Trees */
.cw-tree { overflow: auto; background: var(--cw-panel); min-height: 0; scrollbar-width: thin; }
.cw-source { border-right: 1px solid var(--cw-border); }
.cw-target { border-left: 1px solid var(--cw-border); }
.cw-tree-title {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 52px;
  padding: 9px 12px 8px;
  background: var(--cw-panel);
  border-bottom: 1px solid var(--cw-border);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cw-tree-kind { display: block; font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--cw-faint); }
.cw-target .cw-tree-title { text-align: right; }
/* Searching a tree: a magnifier in the title's corner opens a box in the name's place. */
.cw-tree-title .cw-tree-name { display: block; overflow: hidden; text-overflow: ellipsis; }
.cw-tree-find { position: absolute; top: 8px; right: 8px; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: none; color: var(--cw-faint); cursor: pointer; }
.cw-target .cw-tree-find { right: auto; left: 8px; }
/* Replacing a tree's schema: a button beside the magnifier, and the form it opens in the tree's place. */
.cw-tree-replace { position: absolute; top: 8px; right: 32px; display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: none; color: var(--cw-faint); cursor: pointer; }
.cw-tree-title:not(.cw-findable) .cw-tree-replace { right: 8px; }
.cw-target .cw-tree-replace { right: auto; left: 32px; }
.cw-target .cw-tree-title:not(.cw-findable) .cw-tree-replace { left: 8px; }
.cw-tree-replace:hover { background: var(--cw-hover); color: var(--cw-text); }
.cw-source .cw-editable.cw-findable { padding-right: 58px; }
.cw-target .cw-editable.cw-findable { padding-left: 58px; }
.cw-searching .cw-tree-replace { display: none; }
.cw-schema-form { display: grid; gap: 8px; padding-bottom: 12px; }
.cw-schema-form > :not(.cw-tree-title) { margin: 0 12px; }
.cw-schema-kinds { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px; border-radius: 7px; background: var(--cw-hover); justify-self: start; }
.cw-schema-kinds button { padding: 3px 8px; border: 0; border-radius: 5px; background: none; color: var(--cw-muted); font: inherit; font-size: 12px; cursor: pointer; }
.cw-schema-kinds button[aria-checked="true"] { background: var(--cw-panel); color: var(--cw-text); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, .1); }
.cw-schema-text { min-height: 160px; padding: 6px 8px; border: 1px solid var(--cw-border); border-radius: var(--cw-radius); background: var(--cw-bg); color: var(--cw-text); font: 12px/1.4 var(--cw-code-font); resize: vertical; }
.cw-schema-text:focus { outline: none; border-color: var(--cw-muted); }
.cw-schema-pick { padding: 4px 6px; border: 1px solid var(--cw-border); border-radius: var(--cw-radius); background: var(--cw-bg); color: var(--cw-text); font: inherit; }
.cw-schema-pick[hidden] { display: none; }
.cw-schema-problem { color: var(--cw-error); font-size: 12px; }
.cw-schema-problem:empty { display: none; }
.cw-schema-actions { display: flex; gap: 8px; }
/* Room for the magnifier beside the name. */
.cw-source .cw-findable { padding-right: 34px; }
.cw-target .cw-findable { padding-left: 34px; }
.cw-tree-find:hover { background: var(--cw-hover); color: var(--cw-text); }
.cw-tree-search { display: none; width: 100%; height: 24px; margin-top: 1px; padding: 0 8px; border: 1px solid var(--cw-border); border-radius: 5px; background: var(--cw-bg); color: var(--cw-text); font: inherit; font-size: 12px; font-weight: 400; }
.cw-tree-search:focus { outline: none; border-color: var(--cw-muted); }
.cw-tree-search::-webkit-search-cancel-button { filter: grayscale(1); opacity: .6; cursor: pointer; }
.cw-searching .cw-tree-name, .cw-searching .cw-tree-find { display: none; }
.cw-searching .cw-tree-search { display: block; }
.cw-match { background: color-mix(in srgb, var(--cw-text) 14%, transparent); color: inherit; border-radius: 2px; }
.cw-no-match { margin: 8px 12px; color: var(--cw-muted); font-size: 12px; }
.cw-no-match[hidden] { display: none; }
.cw-rows { padding: 4px 0 8px; }
.cw-row { display: flex; align-items: center; gap: 6px; height: var(--cw-row-height, 26px); white-space: nowrap; }
.cw-target .cw-row { flex-direction: row-reverse; }
.cw-source .cw-row { cursor: crosshair; }
.cw-row:hover, .cw-row.cw-related { background: var(--cw-hover); }
.cw-row.cw-record .cw-name, .cw-row[data-repeating="true"] .cw-name { font-weight: 600; }
.cw-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cw-row[hidden] { display: none; }
/* The arrow that folds a record's fields away, and the space it takes in rows without one. */
.cw-twisty, .cw-twisty-space { flex: none; width: 12px; height: 16px; margin: 0 -2px; }
.cw-twisty { display: grid; place-items: center; padding: 0; border: 0; border-radius: 3px; background: none; color: var(--cw-faint); cursor: pointer; }
.cw-twisty::before { content: ""; width: 5px; height: 5px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg) translate(-1px, -1px); transition: transform .12s; }
.cw-twisty[aria-expanded="false"]::before { transform: rotate(-45deg); }
.cw-target .cw-twisty[aria-expanded="false"]::before { transform: rotate(135deg); }
.cw-twisty:hover { color: var(--cw-text); background: var(--cw-hover); }
.cw-required { flex: none; margin: 0 -3px; color: var(--cw-error); font-weight: 600; }
.cw-row.cw-linked .cw-name { color: var(--cw-text); }
/* The field being traced. */
.cw-row.cw-traced { background: var(--cw-hover); }
.cw-row.cw-traced .cw-name { font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
/* On a map split into pages, the fields the page shown doesn't use. */
.cw-row.cw-elsewhere { opacity: .45; }
.cw-row:not(.cw-linked):not(.cw-record) .cw-name { color: var(--cw-muted); }
.cw-type {
  flex: none;
  min-width: 26px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--cw-hover);
  color: var(--cw-faint);
  font: 600 9.5px/16px var(--cw-code-font);
  text-align: center;
}
.cw-row[data-repeating="true"] .cw-type { background: var(--cw-accent-soft); color: var(--cw-accent); }
.cw-stub { flex: 1; min-width: 10px; align-self: center; height: 0; }
.cw-row.cw-linked .cw-stub { border-top: 1.5px solid var(--cw-link); }
.cw-row.cw-related .cw-stub { border-top-color: var(--cw-accent); }
.cw-row.cw-error .cw-name { color: var(--cw-error); text-decoration: underline wavy; text-underline-offset: 3px; }
.cw-row.cw-drop-ok { background: var(--cw-accent-soft); box-shadow: inset 0 0 0 1px var(--cw-accent); }
.cw-row.cw-drop-bad { opacity: .45; }

/* Grid */
.cw-grid { position: relative; min-width: 0; min-height: 0; }
.cw-viewport {
  position: absolute;
  inset: 0;
  overflow: auto;
  background-color: var(--cw-bg);
  background-image: var(--cw-grid-image);
  background-size: var(--cw-grid-size);
  background-attachment: local;
  scrollbar-width: thin;
}
.cw-surface-size { position: relative; }
.cw-surface { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
.cw-zoom { position: absolute; right: 10px; bottom: 10px; z-index: 3; display: flex; align-items: center; overflow: hidden; border: 1px solid var(--cw-border); border-radius: 6px; background: var(--cw-panel); box-shadow: var(--cw-shadow); }
.cw-zoom[hidden] { display: none; }
.cw-zoom button { height: 24px; border: 0; background: none; color: var(--cw-muted); font: inherit; font-size: 12px; cursor: pointer; }
.cw-zoom-button { width: 24px; font-size: 15px !important; }
.cw-zoom-label { min-width: 42px; border-left: 1px solid var(--cw-border) !important; border-right: 1px solid var(--cw-border) !important; font-variant-numeric: tabular-nums; }
.cw-zoom button:hover { background: var(--cw-hover); color: var(--cw-text); }
/* Page tabs, along the bottom of the grid, clear of the zoom. */
.cw-pages { position: absolute; left: 10px; bottom: 10px; z-index: 3; display: flex; align-items: center; max-width: calc(100% - 160px); overflow-x: auto; scrollbar-width: none; border: 1px solid var(--cw-border); border-radius: 6px; background: var(--cw-panel); box-shadow: var(--cw-shadow); }
.cw-pages[hidden] { display: none; }
.cw-pages > * { flex: none; }
.cw-pages > * + * { border-left: 1px solid var(--cw-border) !important; }
.cw-page-tab { display: inline-flex; align-items: center; gap: 5px; height: 24px; max-width: 140px; padding: 0 10px; border: 0; background: none; color: var(--cw-muted); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.cw-page-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* How many of a traced field's operators a page holds. */
.cw-page-count { flex: none; min-width: 16px; padding: 0 5px; border-radius: 8px; background: var(--cw-hover); color: var(--cw-text); font-size: 10px; font-weight: 600; line-height: 16px; text-align: center; }
.cw-page-tab[aria-selected="true"] .cw-page-count { background: var(--cw-panel); }
/* A long name is cut short; a bar of tabs too wide scrolls, with the list of every page at its end. */
/* + and the list of every page stay at the bar's ends while the tabs scroll between them. */
.cw-page-add { position: sticky; left: 0; z-index: 1; background: var(--cw-panel); }
.cw-page-menu { position: sticky; right: 0; z-index: 1; display: grid; place-items: center; width: 24px; height: 24px; background: var(--cw-panel); color: var(--cw-muted); }
.cw-page-menu[hidden] { display: none; }
.cw-page-menu::before { content: ""; width: 5px; height: 5px; margin-top: -3px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); }
.cw-page-menu:hover { background: var(--cw-hover); color: var(--cw-text); }
.cw-page-list { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.cw-page-tab:hover { background: var(--cw-hover); color: var(--cw-text); }
.cw-page-tab[aria-selected="true"] { background: var(--cw-hover); color: var(--cw-text); font-weight: 600; }
.cw-page-tab.cw-error::after { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--cw-error); }
.cw-page-tab.cw-drop-ok { background: var(--cw-hover); color: var(--cw-text); }
.cw-page-add { width: 24px; padding: 0; justify-content: center; font-size: 15px; }
/* Delete shows on the open tab when it's hovered. */
.cw-page-remove { margin-right: -5px; padding: 0 2px; border-radius: 3px; color: var(--cw-muted); font-size: 10px; font-weight: 400; opacity: 0; }
.cw-page-tab:hover .cw-page-remove, .cw-page-remove:focus-visible { opacity: 1; }
.cw-page-remove:hover { background: var(--cw-hover); color: var(--cw-text); }
.cw-page-name { width: 110px; height: 24px; padding: 0 10px; border: 0; background: none; color: var(--cw-text); font: inherit; font-size: 12px; font-weight: 600; outline: none; background: var(--cw-hover); }
.cw-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  pointer-events: none;
  color: var(--cw-faint);
  text-align: center;
  font-size: 12.5px;
  line-height: 1.6;
}
.cw-empty[hidden] { display: none; }

/* Preview: each target field's value for the sample input, and a status line when there isn't one. */
.cw-sample {
  flex: 0 1 auto;
  min-width: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--cw-accent-soft);
  color: var(--cw-accent);
  font: 500 10.5px/16px var(--cw-code-font);
}
.cw-sample:empty { display: none; }
/* Short of room, the sample gives way first, then the name, cut short with "…". A right-aligned
   name that didn't shrink would spill off the pane's left edge, where it can't be scrolled to. */
.cw-target .cw-row .cw-name { flex: 0 1 auto; }
.cw-target .cw-row .cw-sample { flex-shrink: 1000; }
.cw-sample.cw-left-out { background: none; color: var(--cw-faint); font-style: italic; font-family: inherit; }
.cw-preview-status {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 3;
  max-width: calc(100% - 20px);
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--cw-error) 30%, var(--cw-panel));
  border-radius: 6px;
  background: color-mix(in srgb, var(--cw-error) 9%, var(--cw-panel));
  color: var(--cw-error);
  font-size: 12px;
  box-shadow: var(--cw-shadow);
}
.cw-preview-status[hidden] { display: none; }
.cw-preview-status.cw-info { border-color: var(--cw-border); background: var(--cw-panel); color: var(--cw-muted); }
.cw-node.cw-preview-failed { box-shadow: 0 0 0 2px var(--cw-bg), 0 0 0 4px var(--cw-error), var(--cw-node-shadow, var(--cw-shadow)); }

/* Read-only: no toolbox column, nothing to grab and no inspector. */
.cw-readonly .cw-body { grid-template-columns: minmax(96px, 1fr) minmax(140px, 2fr) minmax(96px, 1fr); }
.cw-readonly .cw-out, .cw-readonly .cw-inspector { display: none !important; }
.cw-readonly .cw-node, .cw-readonly .cw-source .cw-row { cursor: default; }
.cw-no-grid .cw-body { grid-template-columns: minmax(96px, 1fr) clamp(72px, 14%, 160px) minmax(96px, 1fr); }
.cw-no-grid .cw-viewport { background: var(--cw-panel); }
.cw-no-grid .cw-empty { display: none; }
.cw-no-types .cw-type { display: none; }
/* Without operators, a line that went through some is dashed finely, so it doesn't read as a straight copy. */
.cw-line.cw-through { stroke-dasharray: 2 3; }
.cw-readonly .cw-node.cw-selected { box-shadow: 0 0 0 3px color-mix(in srgb, var(--cw-node-border, var(--cw-node, #6b7280)) 25%, transparent), var(--cw-node-shadow, var(--cw-shadow)); }

/* Links */
.cw-links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; overflow: hidden; }
.cw-line { stroke: var(--cw-link); stroke-width: var(--cw-link-width); fill: none; stroke-linecap: round; transition: opacity .12s, stroke .12s; }
.cw-line.cw-loop { stroke-dasharray: 7 5; }
.cw-line.cw-scope { stroke-dasharray: 1.5 4; }
/* What a record link maps inside the record, field to field: faint and finely dotted. */
.cw-line.cw-submap-line { stroke: color-mix(in srgb, var(--cw-accent) 45%, var(--cw-link)); stroke-width: 1.2; stroke-dasharray: 1 3; opacity: .85; }
/* The label on a record link: its sub-map, or "copy". */
.cw-pill { pointer-events: all; cursor: pointer; }
.cw-pill rect { fill: var(--cw-panel); stroke: color-mix(in srgb, var(--cw-accent) 45%, var(--cw-border)); stroke-width: 1; }
.cw-pill text { fill: var(--cw-text); font-size: 10.5px; font-weight: 600; }
.cw-pill:hover rect, .cw-pill.cw-selected rect { stroke: var(--cw-accent); stroke-width: 1.5; }
.cw-readonly .cw-pill { cursor: default; }
/* A record link carries a whole record: drawn heavier than a value's. */
.cw-line.cw-record-link { stroke-width: calc(var(--cw-link-width) + 2px); stroke-opacity: .75; }
.cw-links.cw-focus .cw-line:not(.cw-related):not(.cw-selected):not(.cw-drag) { opacity: .28; }
.cw-line.cw-related { stroke: var(--cw-accent); stroke-width: 2; }
.cw-line.cw-selected { stroke: var(--cw-accent); stroke-width: 3; }
/* A line to a field scrolled out of view, drawn to the tree's edge. */
.cw-line.cw-offscreen:not(.cw-related):not(.cw-selected) { opacity: .35; }
/* An operator off the paths from what a tree's search matches. */
.cw-node.cw-filtered { display: none; }
.cw-search-on .cw-note { display: none; }
.cw-line.cw-drag { stroke: var(--cw-accent); stroke-dasharray: 5 4; stroke-width: 2; }
/* A line that carries on from or to an operator on another page, and its label. */
.cw-line.cw-offpage { stroke-dasharray: 3 3; }
.cw-page-stub { pointer-events: all; cursor: pointer; }
.cw-page-stub rect { fill: var(--cw-panel); stroke: var(--cw-border); stroke-width: 1; }
.cw-page-stub text { fill: var(--cw-muted); font-size: 10.5px; }
.cw-page-stub:hover rect { stroke: var(--cw-muted); }
.cw-page-stub:hover text { fill: var(--cw-text); }
.cw-hit { stroke: transparent; stroke-width: 12; fill: none; pointer-events: stroke; cursor: pointer; }

/* Nodes */
.cw-node {
  position: absolute;
  z-index: 2;
  width: var(--cw-node-size, 34px);
  height: var(--cw-node-size, 34px);
  border-radius: var(--cw-node-radius);
  font-size: var(--cw-node-glyph-size, 13.5px);
  box-shadow: var(--cw-node-shadow, var(--cw-shadow));
  cursor: move;
  transition: box-shadow .12s, border-color .12s;
}
/* The rings add to a tile's own shadow (--cw-node-shadow, such as a stamp), rather than replacing it. */
.cw-node:hover, .cw-node.cw-related { box-shadow: var(--cw-node-shadow, 0 0 0 transparent), 0 0 0 3px color-mix(in srgb, var(--cw-node-border, var(--cw-node, #6b7280)) 25%, transparent), var(--cw-shadow); }
.cw-node.cw-selected { box-shadow: var(--cw-node-shadow, 0 0 0 transparent), 0 0 0 2px var(--cw-bg), 0 0 0 4px var(--cw-accent), var(--cw-shadow); }
.cw-node.cw-drop-ok { box-shadow: var(--cw-node-shadow, 0 0 0 transparent), 0 0 0 2px var(--cw-bg), 0 0 0 4px var(--cw-accent), 0 0 0 8px var(--cw-accent-soft); }
.cw-node.cw-drop-bad { opacity: .4; }
.cw-node.cw-error::before {
  content: "!";
  position: absolute;
  top: -7px;
  left: -7px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--cw-error);
  border: 2px solid var(--cw-bg);
  color: #fff;
  font-size: 9px;
  line-height: 11px;
  text-align: center;
}
.cw-caption {
  position: absolute;
  top: 38px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--cw-bg) 85%, transparent);
  color: var(--cw-muted);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0;
  pointer-events: none;
}
.cw-out {
  position: absolute;
  right: -6px;
  top: 50%;
  width: 11px;
  height: 11px;
  margin-top: -5.5px;
  border-radius: 50%;
  background: var(--cw-panel);
  border: 2px solid var(--cw-node, #6b7280);
  cursor: crosshair;
  transition: transform .1s, background .1s;
}
.cw-out:hover { background: var(--cw-node, #6b7280); transform: scale(1.25); }
/* A see-through tint of the accent, since many themes' soft accent is solid and would hide what's being selected. */
.cw-marquee { position: absolute; z-index: 3; border: 1px solid var(--cw-accent); border-radius: 3px; background: color-mix(in srgb, var(--cw-accent) 12%, transparent); pointer-events: none; }
.cw-ghost { position: fixed; z-index: 10; pointer-events: none; opacity: .9; box-shadow: var(--cw-shadow); }

/* Inspector */
.cw-inspector {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 3;
  width: min(280px, calc(100% - 20px));
  max-height: calc(100% - 20px);
  overflow: auto;
  display: none;
  padding: 12px 14px 14px;
  background: var(--cw-panel);
  border: 1px solid var(--cw-border);
  border-radius: var(--cw-radius);
  box-shadow: 0 8px 28px rgba(16, 24, 40, .14);
  user-select: text;
  -webkit-user-select: text;
}
.cw-inspector.cw-open { display: block; }
.cw-inspector h3 { display: flex; align-items: center; gap: 9px; margin: 0 0 6px; font-size: 13px; font-weight: 600; }
.cw-inspector h3 .cw-chip { flex: none; cursor: default; transform: none; filter: none; }
.cw-inspector p { margin: 0 0 8px; color: var(--cw-muted); font-size: 12px; }
.cw-inspector h4 { margin: 12px 0 6px; font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--cw-faint); }
.cw-id { display: block; color: var(--cw-faint); font: 500 11px var(--cw-code-font); }
.cw-input { display: grid; grid-template-columns: 62px minmax(0, 1fr) 16px 16px; gap: 6px; align-items: center; margin-bottom: 5px; font-size: 12px; }
.cw-input-label { color: var(--cw-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-from {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--cw-hover);
  font: 11.5px/16px var(--cw-code-font);
}
.cw-inspector input, .cw-inspector select {
  width: 100%;
  font: 11.5px/16px var(--cw-code-font);
  padding: 3px 7px;
  border: 1px solid var(--cw-border);
  border-radius: 5px;
  background: var(--cw-bg);
  color: var(--cw-text);
}
.cw-inspector input:focus, .cw-inspector select:focus { outline: none; border-color: var(--cw-accent); box-shadow: 0 0 0 3px var(--cw-accent-soft); }
.cw-inspector select { font-family: inherit; font-size: 12px; }
.cw-icon-button {
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--cw-faint);
  cursor: pointer;
  padding: 0;
  width: 16px;
  height: 16px;
  font-size: 12px;
  line-height: 16px;
}
.cw-icon-button:hover { color: var(--cw-text); background: var(--cw-hover); }
.cw-icon-button.cw-remove:hover { color: var(--cw-error); }
.cw-inspector h3 .cw-icon-button { margin-left: auto; align-self: flex-start; }
.cw-issue { margin: 6px 0 0; padding: 6px 8px; border-radius: 6px; font-size: 12px; color: var(--cw-error); background: color-mix(in srgb, var(--cw-error) 9%, var(--cw-panel)); }
.cw-issue.cw-warning { color: var(--cw-muted); background: var(--cw-hover); }
.cw-delete {
  margin-top: 12px;
  padding: 5px 10px;
  border: 1px solid var(--cw-border);
  border-radius: 6px;
  background: var(--cw-panel);
  color: var(--cw-error);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.cw-delete:hover { background: color-mix(in srgb, var(--cw-error) 8%, var(--cw-panel)); border-color: color-mix(in srgb, var(--cw-error) 35%, var(--cw-panel)); }

/* Inspector controls beyond inputs */
.cw-inspector textarea.cw-table {
  display: block;
  width: 100%;
  margin: -1px 0 8px;
  padding: 5px 7px;
  border: 1px solid var(--cw-border);
  border-radius: 5px;
  background: var(--cw-bg);
  color: var(--cw-text);
  font: 11.5px/16px var(--cw-code-font);
  resize: vertical;
}
.cw-inspector textarea.cw-table:focus { outline: none; border-color: var(--cw-accent); box-shadow: 0 0 0 3px var(--cw-accent-soft); }
.cw-sort { display: grid; grid-template-columns: minmax(0, 1fr) auto 16px; gap: 6px; align-items: center; margin-bottom: 5px; }
.cw-inspector .cw-sort + select, .cw-inspector h4 + select { margin-bottom: 5px; }
.cw-check { display: flex; align-items: center; gap: 7px; margin-top: 10px; font-size: 12px; color: var(--cw-muted); cursor: pointer; }
.cw-inspector .cw-check input { width: auto; margin: 0; accent-color: var(--cw-accent); }
.cw-button {
  padding: 3px 9px;
  border: 1px solid var(--cw-border);
  border-radius: 5px;
  background: var(--cw-panel);
  color: var(--cw-text);
  font: inherit;
  font-size: 11.5px;
  white-space: nowrap;
  cursor: pointer;
}
.cw-button:hover { background: var(--cw-hover); }
.cw-inspector select + p:empty { display: none; }
.cw-inspector select + p, .cw-inspector select + .cw-button { margin-top: 6px; }

/* The bar for switching between the main map and its sub-maps */
.cw-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--cw-border); background: var(--cw-panel); font-size: 12px; }
.cw-bar[hidden] { display: none; }
.cw-bar-label { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--cw-faint); }
.cw-bar select { padding: 3px 7px; border: 1px solid var(--cw-border); border-radius: 5px; background: var(--cw-bg); color: var(--cw-text); font: inherit; }
.cw-bar-note { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cw-muted); }

/* Notes: for people reading the map, ignored when it runs */
.cw-note-chip { --cw-node: color-mix(in srgb, var(--cw-note) 85%, #000 6%); --cw-node-fg: #3d3000; }
.cw-note {
  position: absolute;
  z-index: 2;
  width: 170px;
  border: 1px solid color-mix(in srgb, var(--cw-note) 55%, var(--cw-border));
  border-radius: 6px;
  background: color-mix(in srgb, var(--cw-note) 24%, var(--cw-panel));
  box-shadow: var(--cw-shadow);
}
.cw-note-grip { display: flex; justify-content: flex-end; height: 16px; padding: 1px 2px; border-radius: 6px 6px 0 0; cursor: move; }
.cw-note-grip .cw-icon-button { opacity: 0; }
.cw-note:hover .cw-note-grip .cw-icon-button, .cw-note:focus-within .cw-note-grip .cw-icon-button { opacity: 1; }
.cw-note-text {
  display: block;
  width: 100%;
  min-height: 48px;
  padding: 0 9px 8px;
  border: 0;
  background: none;
  color: var(--cw-text);
  font: 12px/1.45 var(--cw-font);
  resize: none;
  field-sizing: content;
  outline: none;
  user-select: text;
  -webkit-user-select: text;
}
.cw-readonly .cw-note-text { padding-top: 8px; cursor: default; }
.cw-note.cw-moving { pointer-events: none; opacity: .85; }
.cw-note-on {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  padding: 0 4px 0 8px;
  color: var(--cw-faint);
  font: 500 10px/14px var(--cw-code-font);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cw-leader { stroke: color-mix(in srgb, #c9a227 70%, var(--cw-text)); stroke-width: 1; stroke-dasharray: 3 3; fill: none; }
.cw-leader-dot { fill: color-mix(in srgb, #c9a227 70%, var(--cw-text)); }
.cw-inspector .cw-note-quote { padding: 6px 8px; border-left: 3px solid color-mix(in srgb, var(--cw-note) 85%, #000 6%); border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--cw-note) 18%, var(--cw-panel)); color: var(--cw-text); white-space: pre-wrap; }
`;

/** Adds a stylesheet to the document once, by id, or updates it when its CSS has changed. */
export function injectStyle(target: Document, id: string, css: string): void {
  const existing = target.getElementById(id);
  if (existing) {
    // Keeps a hot-reloaded page, or a re-registered theme, in step.
    if (existing.textContent !== css) existing.textContent = css;
    return;
  }
  const style = target.createElement("style");
  style.id = id;
  style.textContent = css;
  target.head.append(style);
}

export function injectStyles(target: Document): void {
  injectStyle(target, "crosswalk-styles", styles);
}
