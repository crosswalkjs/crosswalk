import { defineTheme } from "@crosswalkjs/canvas";

// Try another accent, `extends: "dracula"`, `links: "elbow"` or
// `shape: { node: "50%" }` for round tiles.
export const brand = defineTheme({
  id: "brand",
  label: "Brand",
  extends: "nord",
  colors: { accent: "#e5007d" },
});
