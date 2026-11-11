import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@crosswalkjs/core": fileURLToPath(new URL("packages/core/src/index.ts", import.meta.url)) },
  },
  // A test checks the docs' big map. Without this, building it reads the docs' tsconfig, which
  // extends a Docusaurus package that isn't installed outside the docs.
  esbuild: { tsconfigRaw: "{}" },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
