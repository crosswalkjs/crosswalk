import { createMapper } from "@crosswalkjs/canvas";
import { createAsyncTransform } from "@crosswalkjs/core";
import { registry } from "./crosswalk.js";
import startingMap from "./customer.map.json";

// Try an id ending in an odd digit.
const customer = { CustomerId: "C-1042", Name: "Ana Lima" };
const output = document.getElementById("output");

// A map with an operator that waits runs with createAsyncTransform.
async function show(map) {
  try {
    output.textContent = JSON.stringify(await createAsyncTransform(map, { registry })(customer), null, 2);
  } catch (error) {
    output.textContent = error.message;
  }
}

createMapper(document.getElementById("mapper"), { document: startingMap, registry, onChange: show });
show(startingMap);
