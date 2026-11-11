import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Serves the fixture page from the library's source, like the playground.
export default defineConfig({
  root: fileURLToPath(new URL("fixture", import.meta.url)),
  resolve: {
    alias: {
      "@crosswalkjs/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
      "@crosswalkjs/canvas": fileURLToPath(new URL("../packages/canvas/src/index.ts", import.meta.url)),
    },
  },
  // The fixture borrows the docs' example maps. Without this, building them reads the docs' tsconfig,
  // which extends a Docusaurus package that isn't installed outside the docs.
  esbuild: { tsconfigRaw: "{}" },
  server: { port: 5180, strictPort: true, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
});
