import { createMapper } from "@crosswalkjs/canvas";
import startingMap from "./order.map.json";

const output = document.getElementById("output");
const log = (...parts) => (output.textContent = `${parts.join(" ")}\n${output.textContent}`);

// Click an operator, a line or a loop; press Escape; delete something to make an issue.
createMapper(document.getElementById("mapper"), {
  document: startingMap,
  toolboxCollapsed: true,
  onSelectionChange: (selection) => log("Selected:", selection ? JSON.stringify(selection) : "nothing"),
  onPageChange: (page, submap) => log("Showing:", submap ? `sub-map ${submap}` : "the main map", page ? `page ${page}` : ""),
  onIssuesChange: (issues) => log("Issues:", issues.length === 0 ? "none" : issues.map((issue) => issue.code).join(", ")),
});
