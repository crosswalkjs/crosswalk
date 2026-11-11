import { createMapper, previewOverHttp } from "@crosswalkjs/canvas";
import { loadRegistry } from "./crosswalk.js";
import startingMap from "./customer.map.json";

// Customer tier only exists on the server, so the preview runs there too.
// Try a CustomerId ending in an odd digit.
const sample = { CustomerId: "C-1042", Name: "Ana Lima" };

loadRegistry().then((registry) => {
  createMapper(document.getElementById("mapper"), {
    document: startingMap,
    registry,
    preview: { input: sample, run: previewOverHttp("/crosswalk/preview") },
  });
});
