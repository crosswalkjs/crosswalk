import { bundleSchema, inferSchema } from "@crosswalkjs/core";
import { createMapper } from "@crosswalkjs/canvas";

const load = (address) => fetch(address).then((response) => response.json());
const output = document.getElementById("output");

// order.json refers to customer.json and common/types.json, which refer on.
load("/api/schemas/order.json")
  .then((order) => bundleSchema(order, load, "/api/schemas/order.json"))
  .then((source) => {
    output.textContent = `Brought into $defs: ${Object.keys(source.$defs).join(", ")}\n\n${JSON.stringify(source, null, 2)}`;
    createMapper(document.getElementById("mapper"), {
      document: { version: 1, source, target: inferSchema({ Reference: "", Buyer: "", Town: "" }), nodes: [], links: [] },
      toolboxCollapsed: true,
    });
  });
