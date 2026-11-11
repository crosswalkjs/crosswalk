import { createRegistry, defineOperator, toText } from "@crosswalkjs/core";

// Try changing what `run` returns, such as joining the letters with ".", and
// watch the output below the editor.
const initials = defineOperator({
  kind: "value",
  id: "acme.initials",
  label: "Initials",
  glyph: "AB.",
  category: "text",
  description: "The first letter of each word, in capitals.",
  inputs: { min: 1, max: 1, labels: ["name"] },
  run: ([name]) =>
    toText(name ?? null)
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0].toUpperCase())
      .join(""),
});

export const registry = createRegistry({ operators: [initials] });
