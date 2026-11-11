import { createMapper } from "@crosswalkjs/canvas";
import { createRegistry } from "@crosswalkjs/core";
import { aurora } from "./crosswalk.js";
import { initials } from "./initials.js";
import startingMap from "./person.map.json";

// An Acme operator, so the theme's acme colour has a tile to show on.
const registry = createRegistry({ operators: [initials] });

createMapper(document.getElementById("mapper"), { document: startingMap, registry, theme: aurora });
