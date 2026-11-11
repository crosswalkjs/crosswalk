import { createRegistry, defineOperator, OperatorError, toText } from "@crosswalkjs/core";

// api.example.com is answered by the sandbox, after a moment, as a real
// lookup would take: Gold for an id ending in an even digit, Silver otherwise.
const tier = defineOperator({
  kind: "value",
  async: true,
  id: "acme.customerTier",
  label: "Customer tier",
  category: "acme",
  inputs: { min: 1, max: 1, labels: ["customer id"] },
  run: async ([id], { signal }) => {
    const response = await fetch(`https://api.example.com/customers/${toText(id ?? null)}/tier`, { signal });
    if (!response.ok) throw new OperatorError(`No tier for customer ${toText(id ?? null)}`);
    return (await response.json()).tier;
  },
});

export const registry = createRegistry({ operators: [tier] });
