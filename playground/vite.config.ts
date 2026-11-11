import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    // Use the source rather than dist, so edits to core show up without a build.
    alias: {
      "@crosswalkjs/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
      "@crosswalkjs/canvas": fileURLToPath(new URL("../packages/canvas/src/index.ts", import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
});
