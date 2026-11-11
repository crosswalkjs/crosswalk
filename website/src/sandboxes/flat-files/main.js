import { createTransform, readFlatFile, writeFlatFile } from "@crosswalkjs/core";
import { createMapper } from "@crosswalkjs/canvas";
import { bankFile, payments } from "./schemas.js";

const output = document.getElementById("output");

fetch("/api/payments.csv")
  .then((response) => response.text())
  .then((csv) => {
    // The CSV, read into the JSON a map takes: { rows: [{ id, date, payee, amount, reference }, …] }.
    const input = readFlatFile(csv, payments);

    // CSV in, through the map, fixed-width out: run every time the map changes.
    const run = (map) => {
      try {
        // Shows the spaces, so the columns can be seen.
        output.textContent = writeFlatFile(createTransform(map)(input), bankFile).replaceAll(" ", "·");
      } catch (error) {
        output.textContent = error.message;
      }
    };

    const map = {
      version: 1,
      source: payments,
      target: bankFile,
      nodes: [
        { id: "sender", operator: "text.concat", constants: { 0: "ACME LTD" }, position: { x: 40, y: 20 } },
        { id: "date", operator: "date.format", constants: { 1: "yyyyMMdd" }, position: { x: 40, y: 100 } },
        { id: "payee", operator: "text.upper", position: { x: 40, y: 180 } },
        { id: "count", operator: "aggregate.count", scope: "rows[]", position: { x: 170, y: 170 } },
        { id: "total", operator: "aggregate.sum", scope: "rows[]", position: { x: 170, y: 240 } },
      ],
      links: [
        { from: { node: "sender" }, to: { target: "header.sender" } },
        { from: { source: "rows[].date" }, to: { node: "date", input: 0 } },
        { from: { node: "date" }, to: { target: "lines[].date" } },
        { from: { source: "rows[].payee" }, to: { node: "payee", input: 0 } },
        { from: { node: "payee" }, to: { target: "lines[].payee" } },
        { from: { source: "rows[].amount" }, to: { target: "lines[].pence" } },
        // The trailer counts and totals the payments, as banks check them.
        { from: { source: "rows[].id" }, to: { node: "count", input: 0 } },
        { from: { node: "count" }, to: { target: "trailer.count" } },
        { from: { source: "rows[].amount" }, to: { node: "total", input: 0 } },
        { from: { node: "total" }, to: { target: "trailer.pence" } },
      ],
      loops: [{ source: "rows[]", target: "lines[]" }],
    };
    // Try mapping Reference: a long one is refused rather than cut short.
    createMapper(document.getElementById("mapper"), { document: map, toolboxCollapsed: true, onChange: run });
    run(map);
  });
