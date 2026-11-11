import { defineTheme } from "@crosswalkjs/canvas";

// Try extends: "dracula", links: "straight", or another colour for acme.
export const aurora = defineTheme({
  id: "aurora",
  label: "Aurora",
  extends: "nord",
  colors: { accent: "#f5a3c7", accentSoft: "rgba(245, 163, 199, .18)" },
  categories: { acme: "#a3be8c" }, // tile colours, by category id
  links: "elbow",
  shape: { node: "50%", chip: "50%" }, // round tiles
});
