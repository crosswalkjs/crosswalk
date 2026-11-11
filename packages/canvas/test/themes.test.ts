import { describe, expect, it } from "vitest";
import { defineTheme, listThemes, registerTheme, resolveTheme, themes, themeStyles } from "../src/themes.js";
import type { ThemeDefinition } from "../src/themes.js";

describe("themes", () => {
  it("fills in a theme from Studio by default", () => {
    const pink = resolveTheme(defineTheme({ id: "pink", label: "Pink", colors: { accent: "#ff3399" } }));
    expect(pink.colors.accent).toBe("#ff3399");
    expect(pink.colors.background).toBe(resolveTheme("studio").colors.background);
    expect(pink.links).toBe("curved");
    expect(pink.scheme).toBe("auto");
  });

  it("extends another theme by id, and changes only what it sets", () => {
    const night = resolveTheme(
      defineTheme({ id: "night", label: "Night", extends: "nord", categories: { text: "#ff0000" }, links: "elbow" }),
    );
    const nord = resolveTheme("nord");
    expect(night.colors).toEqual(nord.colors);
    expect(night.categories.text).toBe("#ff0000");
    expect(night.categories.math).toBe(nord.categories.math);
    expect(night.links).toBe("elbow");
    expect(night.scheme).toBe("dark");
  });

  it("generates CSS scoped to the theme, with a dark block only for automatic themes", () => {
    const studioCss = themeStyles(resolveTheme("studio"));
    expect(studioCss).toContain('.cw-root[data-cw-theme="studio"] {');
    expect(studioCss).toContain("@media (prefers-color-scheme: dark)");
    const nordCss = themeStyles(resolveTheme("nord"));
    expect(nordCss).not.toContain("@media");
    expect(nordCss).toContain('.cw-root[data-cw-theme="nord"] .cw-cat-text { --cw-node: #bf616a; }');
  });

  it("sizes rows, operators and chips by density, and tints notes", () => {
    const roomy = resolveTheme(defineTheme({ id: "roomy-notes", label: "Roomy", density: "roomy", colors: { note: "#9fd3ff" } }));
    const css = themeStyles(roomy);
    expect(css).toContain("--cw-row-height: 31px;");
    expect(css).toContain("--cw-node-size: 40px;");
    expect(css).toContain("--cw-note: #9fd3ff;");
    expect(resolveTheme("nord").density).toBe("regular");
    expect(() => defineTheme({ id: "bad", label: "Bad", density: "huge" as never })).toThrow("density must be compact, regular or roomy");
  });

  it("makes registered themes available by id", () => {
    registerTheme({ id: "house", label: "House style", extends: "paper", colors: { accent: "#0a7" } });
    expect(listThemes().map((t) => t.id)).toContain("house");
    expect(resolveTheme("house").shape.node).toBe("50%");
  });

  it("refuses unknown themes, loops and ids that can't be used in CSS", () => {
    expect(() => resolveTheme("nope")).toThrow(/Unknown theme/);
    const a = defineTheme({ id: "a", label: "A" });
    a.extends = a;
    expect(() => resolveTheme(a)).toThrow(/extends itself/);
    expect(() => defineTheme({ id: 'x"]', label: "Bad" })).toThrow(/must start with a letter/);
  });

  it("refuses values that would break out of their CSS, since a theme can come from a customer", () => {
    const bad = [
      { colors: { accent: "red; } body { display: none" } },
      { colors: { panel: "url(https://example.com/track.png)" } },
      { fonts: { ui: "13px Inter /* comment" } },
      { categories: { "x { }": "#fff" } },
      { shape: { node: "4px\\3b" } },
      { links: "wavy" },
    ];
    for (const extra of bad) {
      expect(() => resolveTheme({ id: "customer", label: "Customer", ...extra } as ThemeDefinition)).toThrow();
    }
    // Ordinary values, commas, quotes and functions included, are fine.
    expect(() =>
      resolveTheme({
        id: "customer",
        label: "Customer",
        colors: { accent: "rgb(229 0 125 / 80%)", shadow: "0 1px 2px rgba(0, 0, 0, .2), 0 0 0 1px #0001" },
        fonts: { ui: '13px/1.4 "Inter Variable", sans-serif' },
        categories: { acme: "color-mix(in srgb, #ff3366 80%, white)" },
      }),
    ).not.toThrow();
  });

  it("ships fourteen built-in themes", () => {
    expect(themes.map((t) => t.id)).toHaveLength(14);
  });

  it("lets a theme colour every category with *, including ones a registry adds", () => {
    const css = themeStyles(resolveTheme({ id: "mono", label: "Mono", categories: { "*": "#111111", math: "#222222" } }));
    expect(css).toContain('[data-cw-theme="mono"] [class*="cw-cat-"] { --cw-node: #111111; }');
    // A named category still wins, coming after.
    expect(css.indexOf("cw-cat-math { --cw-node: #222222")).toBeGreaterThan(css.indexOf('[class*="cw-cat-"]'));
  });

  it("outlines every tile in a theme's tileBorder, and leaves the outline to each tile otherwise", () => {
    expect(themeStyles(resolveTheme({ id: "outlined", label: "Outlined", tileBorder: "#111111" }))).toContain("--cw-node-border: #111111;");
    expect(themeStyles(resolveTheme("studio"))).not.toContain("--cw-node-border:");
  });

  it("gives every tile a theme's tileShadow, which hover and selection rings add to", () => {
    expect(themeStyles(resolveTheme({ id: "stamped", label: "Stamped", tileShadow: "2px 2px 0 #111111" }))).toContain("--cw-node-shadow: 2px 2px 0 #111111;");
    expect(themeStyles(resolveTheme("studio"))).not.toContain("--cw-node-shadow:");
  });
});
