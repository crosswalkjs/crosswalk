import { createMapper } from "@crosswalkjs/canvas";
import orderMap from "./order.map.json";
import lineMap from "./order-line.map.json";

const mapper = createMapper(document.getElementById("mapper"), { document: orderMap });
const on = (id, action) => document.getElementById(id).addEventListener("click", action);

// Make a change in the editor, then try undo and redo.
on("undo", () => mapper.undo());
on("redo", () => mapper.redo());
on("issues", () => console.log(mapper.getIssues()));
on("document", () => console.log(`${mapper.getDocument().links.length} links, ${mapper.getDocument().nodes.length} operators`));

let dark = false;
on("theme", () => mapper.setTheme((dark = !dark) ? "dracula" : "studio"));

let showingOrder = true;
on("load", () => mapper.setDocument((showingOrder = !showingOrder) ? orderMap : lineMap));
on("destroy", () => mapper.destroy());
