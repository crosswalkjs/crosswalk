import { createMapper } from "@crosswalkjs/canvas";
import { createTransform } from "@crosswalkjs/core";
import { registry } from "./crosswalk.js";
import startingMap from "./team.map.json";

const team = { Team: "Billing", People: [{ Name: "Ana" }, { Name: "Bartholomew" }, { Name: "Kai" }] };
const output = document.getElementById("output");

function show(map) {
  try {
    output.textContent = JSON.stringify(createTransform(map, { registry })(team), null, 2);
  } catch (error) {
    output.textContent = error.message;
  }
}

createMapper(document.getElementById("mapper"), { document: startingMap, registry, onChange: show });
show(startingMap);
