import { createMapper, defineTheme } from "@crosswalkjs/canvas";
import startingMap from "./order.map.json";

const mapper = createMapper(document.getElementById("mapper"), { document: startingMap });

async function useSavedTheme(url) {
  const response = await fetch(url);
  let theme = "studio";
  try {
    theme = defineTheme(await response.json());
  } catch (error) {
    console.warn("Ignoring the saved theme:", error);
  }
  mapper.setTheme(theme);
}

// Try "/api/tampered-theme.json", whose accent tries to add CSS of its own.
useSavedTheme("/api/customer-theme.json");
