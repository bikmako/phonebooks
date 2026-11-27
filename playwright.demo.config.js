import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/demo-browser',
  timeout: 60000,
  workers: 2,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs: { 'network.dns.ipv4OnlyDomains': 'localhost' } } } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: { command: 'node tools/build-demo.js && node server/demo-server.js', url: 'http://127.0.0.1:4498/api/config', timeout: 90000 },
});
