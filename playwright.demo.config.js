import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/demo-browser',
  workers: 2,
  outputDir: 'test-results-demo',
  // End-to-end workflows include several reloads and local OCR on mobile WebKit.
  timeout: 120000,
  expect: { timeout: 10000 },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'android-chromium', use: { ...devices['Pixel 5'], browserName: 'chromium' } },
    { name: 'iphone-se-webkit', use: { ...devices['iPhone SE'], browserName: 'webkit' } },
  ],
  use: { baseURL: 'http://127.0.0.1:4175/demo/', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build:demo -- --base /demo/ && npm run preview:demo -- --base /demo/ --port 4175', url: 'http://127.0.0.1:4175/demo/', reuseExistingServer: false, timeout: 90000 },
});
