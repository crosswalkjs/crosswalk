import { createMapper } from "@crosswalkjs/canvas";
import { createTransform } from "@crosswalkjs/core";
import startingMap from "./order.map.json";
import sampleOrder from "./sample-order.json";

const output = document.getElementById("output");

function show(map) {
  try {
    output.textContent = JSON.stringify(createTransform(map)(sampleOrder), null, 2);
  } catch (error) {
    output.textContent = error.message;
  }
}

createMapper(document.getElementById("mapper"), { document: startingMap, onChange: show });
show(startingMap);
