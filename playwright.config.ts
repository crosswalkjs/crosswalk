import { defineConfig, devices } from "@playwright/test";

// Drives the real editor in a browser. The unit tests cover the edits; these cover the pointer work around them.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:5180", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
  webServer: { command: "npx vite --config e2e/vite.config.ts", url: "http://localhost:5180", reuseExistingServer: !process.env.CI },
});
