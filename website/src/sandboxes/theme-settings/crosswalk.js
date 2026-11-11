import { defineTheme } from "@crosswalkjs/canvas";

// Most of the settings at once. Try grid: "dots" or "drafting", links:
// "curved", or other corner radii.
export const tour = defineTheme({
  id: "tour",
  label: "Settings tour",
  scheme: "light",
  colors: {
    background: "#fbfaf7",
    panel: "#ffffff",
    accent: "#0f766e",
    accentSoft: "rgba(15, 118, 110, .14)",
    link: "#94a3b8",
  },
  categories: { text: "#be123c", math: "#1d4ed8", flow: "#7c3aed" },
  glyph: "#ffffff",
  fonts: { ui: "13px/1.4 Georgia, serif", code: "ui-monospace, monospace" },
  shape: { radius: "14px", node: "50%", chip: "8px" },
  links: "elbow",
  linkWidth: "2px",
  grid: "lines",
  gridSize: 24,
});
