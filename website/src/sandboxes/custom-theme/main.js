import { createMapper } from "@crosswalkjs/canvas";
import { brand } from "./crosswalk.js";
import startingMap from "./order.map.json";

createMapper(document.getElementById("mapper"), { document: startingMap, theme: brand });
