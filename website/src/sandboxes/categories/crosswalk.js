import { createRegistry, defineCategory } from "@crosswalkjs/core";
import { initials } from "./initials.js";

// A category of your own with its colour, and a built-in one relabelled.
// Try another colour, or relabelling "math".
const acme = defineCategory({ id: "acme", label: "Acme", color: "#ff3366" });
const strings = defineCategory({ id: "text", label: "Strings" });

export const registry = createRegistry({ categories: [acme, strings], operators: [initials] });
