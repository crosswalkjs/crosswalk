import { createRegistry } from "@crosswalkjs/core";

// Everything except the Text operators, which the map doesn't need.
// Try `operator.category !== "math"`: the map uses Multiply, so it then
// reports an unknown operator. Or choose operators by id:
// builtins: (operator) => ["math.multiply", "flow.onlyIf"].includes(operator.id)
export const registry = createRegistry({ builtins: (operator) => operator.category !== "text" });
