import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/updates',
  workers: 1, timeout: 60000,
  expect: { timeout: 15000 },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'firefox-desktop', use: { browserName: 'firefox', viewport: { width: 1280, height: 900 } } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'android-chromium', use: { ...devices['Pixel 5'], browserName: 'chromium' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4175/phonebooks/', headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build -- --base /phonebooks/ && node tools/update-test-server.js',
    url: 'http://127.0.0.1:4175/phonebooks/', timeout: 120000,
  },
});
