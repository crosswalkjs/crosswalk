import { createMapper, registerTheme, resolveTheme } from "@crosswalkjs/canvas";
import startingMap from "./order.map.json";

const studio = resolveTheme("studio");
registerTheme({ id: "app-light", label: "Light", scheme: "light" });
registerTheme({ id: "app-dark", label: "Dark", scheme: "dark", colors: studio.darkColors });

const mapper = createMapper(document.getElementById("mapper"), { document: startingMap, theme: "app-light" });

// Your app's own switch.
let isDark = false;
document.getElementById("switch").addEventListener("click", () => {
  isDark = !isDark;
  mapper.setTheme(isDark ? "app-dark" : "app-light");
});
