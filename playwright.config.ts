import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3099",
    channel: "chrome",
    headless: true,
  },
  projects: [
    {
      name: "chromium-cdp",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "next dev -p 3099",
    url: "http://localhost:3099",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: "3099" },
  },
});
