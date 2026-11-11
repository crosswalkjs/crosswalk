import { createMapper, defineTheme, listThemes, registerTheme } from "@crosswalkjs/canvas";
import startingMap from "./order.map.json";

const aurora = defineTheme({ id: "aurora", label: "Aurora", extends: "nord", colors: { accent: "#f5a3c7" }, links: "elbow" });

// Registered, it can be used by id, listed, and extended by other themes.
registerTheme(aurora);
const mapper = createMapper(document.getElementById("mapper"), { document: startingMap, theme: "aurora" });

const picker = document.getElementById("theme");
for (const theme of listThemes()) picker.append(new Option(theme.label, theme.id, false, theme.id === "aurora"));
picker.addEventListener("change", () => mapper.setTheme(picker.value));
