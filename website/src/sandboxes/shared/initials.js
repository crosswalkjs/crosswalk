import { defineOperator, toText } from "@crosswalkjs/core";

export const initials = defineOperator({
  kind: "value",
  id: "acme.initials",
  label: "Initials",
  glyph: "AB.",
  category: "acme",
  description: "The first letter of each word, in capitals.",
  inputs: { min: 1, max: 1, labels: ["name"] },
  run: ([name]) =>
    toText(name ?? null)
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0].toUpperCase())
      .join(""),
});
