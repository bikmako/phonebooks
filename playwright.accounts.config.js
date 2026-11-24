import { defineConfig, devices } from "@playwright/test";

const chromiumOptions = process.env.PB_SYSTEM_CHROMIUM ? { executablePath: process.env.PB_SYSTEM_CHROMIUM } : undefined;

export default defineConfig({
  testDir: "./tests/account-browser",
  workers: 2,
  timeout: 65000,
  use: { baseURL: "http://localhost:4390", headless: true },
  projects: [
    { name: "chromium", use: { browserName: "chromium", launchOptions: chromiumOptions } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
    { name: "iphone-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  webServer: {
    command: "npm run build:accounts && node tests/support/accounts-stand.js",
    url: "http://localhost:4390/__test/ready",
    timeout: 90000,
  },
});
