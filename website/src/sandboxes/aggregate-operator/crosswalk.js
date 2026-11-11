import { ABSENT, createRegistry, defineOperator, toText } from "@crosswalkjs/core";

// Try the shortest instead, by sorting the other way.
const longest = defineOperator({
  kind: "aggregate",
  id: "acme.longest",
  label: "Longest",
  category: "aggregate",
  inputs: { min: 1, max: 1 },
  reduce: (values) => values.map((v) => toText(v)).sort((a, b) => b.length - a.length)[0] ?? ABSENT,
});

export const registry = createRegistry({ operators: [longest] });
