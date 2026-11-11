import { createMapper } from "@crosswalkjs/canvas";
import startingMap from "./order.map.json";

// Try readOnly: true, mappedOnly: true, autoLayout: true, or theme: "dracula".
createMapper(document.getElementById("mapper"), {
  document: startingMap,
  theme: "ink",
  toolboxCollapsed: true,
  onToolboxToggle: (collapsed) => console.log("Toolbox collapsed:", collapsed),
  onChange: (map) => console.log("Changed: the map has", map.links.length, "links"),
});
