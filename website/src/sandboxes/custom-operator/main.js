import { createMapper } from "@crosswalkjs/canvas";
import { createTransform } from "@crosswalkjs/core";
import { registry } from "./crosswalk.js";
import startingMap from "./person.map.json";

const person = { Name: "Ana Maria Lima" };
const output = document.getElementById("output");

// Maps run with the same registry the editor has.
function show(map) {
  try {
    output.textContent = JSON.stringify(createTransform(map, { registry })(person), null, 2);
  } catch (error) {
    output.textContent = error.message;
  }
}

createMapper(document.getElementById("mapper"), { document: startingMap, registry, onChange: show });
show(startingMap);
