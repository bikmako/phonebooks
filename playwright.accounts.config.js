import { defineConfig, devices } from "@playwright/test";

// Chromium also validates the service worker script outside the page's
// DevTools HTTPS exception. Only this loopback test profile accepts the cert.
const chromiumOptions = {
  ...(process.env.PB_SYSTEM_CHROMIUM ? { executablePath: process.env.PB_SYSTEM_CHROMIUM } : {}),
  args: ["--ignore-certificate-errors"],
};

export default defineConfig({
  testDir: "./tests/account-browser",
  outputDir: "./test-results/accounts",
  workers: 2,
  timeout: 65000,
  use: { baseURL: "https://127.0.0.1:4390", headless: true, ignoreHTTPSErrors: true },
  projects: [
    { name: "chromium", use: { browserName: "chromium", launchOptions: chromiumOptions } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
    { name: "iphone-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
  webServer: {
    command: "npm run build:accounts && node tests/support/accounts-stand.js",
    url: "https://127.0.0.1:4390/__test/ready",
    timeout: 90000,
    ignoreHTTPSErrors: true,
  },
});
