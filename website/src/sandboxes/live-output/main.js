import { createMapper } from "@crosswalkjs/canvas";
import { analyseMap, createRegistry, createTransform } from "@crosswalkjs/core";
import startingMap from "./order.map.json";
import sample from "./sample-order.json";

const registry = createRegistry();
const output = document.getElementById("output");

// Delete a line in the editor, or drag a new one, and the output follows.
function preview(map) {
  const errors = analyseMap(map, registry).issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    // A map with errors can't run, so say why rather than showing old output.
    output.textContent = errors.map((issue) => issue.message).join("\n");
    return;
  }
  output.textContent = JSON.stringify(createTransform(map, { registry })(sample), null, 2);
}

createMapper(document.getElementById("mapper"), { document: startingMap, registry, onChange: preview });
preview(startingMap);
