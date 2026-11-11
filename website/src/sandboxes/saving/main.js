import { createMapper } from "@crosswalkjs/canvas";
import emptyMap from "./empty-order.map.json";

// Draw a line or two, then press Run again: the map comes back from
// localStorage. Reset clears it.
const mapper = createMapper(document.getElementById("mapper"), {
  document: JSON.parse(localStorage.getItem("map") ?? "null") ?? emptyMap,
  onChange: (map) => {
    localStorage.setItem("map", JSON.stringify(map));
    console.log(`Saved: ${map.links.length} line${map.links.length === 1 ? "" : "s"}.`);
  },
});

console.log(localStorage.getItem("map") ? "Loaded the saved map." : "Nothing saved yet, so it starts empty.");
