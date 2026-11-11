import { createTransform, jsonToXml, xmlToJson, xsdSchemas } from "@crosswalkjs/core";
import { createMapper } from "@crosswalkjs/canvas";

const text = (path) => fetch(path).then((response) => response.text());
const output = document.getElementById("output");

Promise.all([text("/api/order.xsd"), text("/api/invoice.xsd"), text("/api/order.xml")]).then(([orderXsd, invoiceXsd, orderXml]) => {
  const source = xsdSchemas(orderXsd)[0].schema;
  const target = xsdSchemas(invoiceXsd)[0].schema;
  // The order, read into the JSON a map takes: number and Qty come out as numbers, Line as an array.
  const input = xmlToJson(orderXml, source);

  // XML in, through the map, XML out: run every time the map changes.
  const run = (map) => {
    try {
      output.textContent = jsonToXml(createTransform(map)(input), target);
    } catch (error) {
      output.textContent = error.message;
    }
  };

  const map = {
    version: 1,
    source,
    target,
    nodes: [],
    links: [
      { from: { source: "number" }, to: { target: "ref" } },
      { from: { source: "Customer" }, to: { target: "BillTo" } },
      { from: { source: "Line[].Sku" }, to: { target: "Item[].Code" } },
    ],
    loops: [{ source: "Line[]", target: "Item[]" }],
  };
  // Try linking Qty to Units, or summing Price into Total.
  createMapper(document.getElementById("mapper"), { document: map, toolboxCollapsed: true, onChange: run });
  run(map);
});
