import { createMapper } from "@crosswalkjs/canvas";
import { registry } from "./crosswalk.js";
import startingMap from "./person.map.json";

createMapper(document.getElementById("mapper"), { document: startingMap, registry });
