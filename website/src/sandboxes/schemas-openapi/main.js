import { openApiSchemas } from "@crosswalkjs/core";
import { createMapper } from "@crosswalkjs/canvas";

const pickers = { source: document.getElementById("source"), target: document.getElementById("target") };
let mapper;

// Every schema the API describes: request and response bodies, then its components.
fetch("/api/shop.json")
  .then((response) => response.json())
  .then((api) => {
    const schemas = openApiSchemas(api);
    for (const picker of Object.values(pickers)) picker.append(...schemas.map((s) => new Option(s.name, s.name)));
    pickers.source.value = "POST /orders request";
    pickers.target.value = "GET /invoices/{id} response 200";

    const show = () => {
      const schema = (picker) => schemas.find((s) => s.name === picker.value).schema;
      mapper?.destroy();
      mapper = createMapper(document.getElementById("mapper"), {
        document: { version: 1, source: schema(pickers.source), target: schema(pickers.target), nodes: [], links: [] },
        toolboxCollapsed: true,
        // The buttons in each tree's heading replace its schema: try pasting a sample.
        editSchemas: true,
      });
    };
    pickers.source.onchange = pickers.target.onchange = show;
    show();
  });
