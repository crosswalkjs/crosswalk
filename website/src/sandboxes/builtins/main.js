import { createMapper } from "@crosswalkjs/canvas";
import { registry } from "./crosswalk.js";
import startingMap from "./order-line.map.json";

const mapper = createMapper(document.getElementById("mapper"), { document: startingMap, registry });

// A map using an operator the registry doesn't have still loads, with an issue.
const issues = mapper.getIssues();
if (issues.length === 0) console.log("No issues: the registry has every operator the map uses.");
for (const issue of issues) console.warn(issue.code, issue.message);
