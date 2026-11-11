import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 2,
  timeout: 60000,
  projects: ['chromium', 'firefox', 'webkit'].flatMap(browserName => [
    { name: browserName + '-desktop', use: { browserName, viewport: { width: 1280, height: 900 } } },
    { name: browserName + '-mobile', use: { browserName, viewport: { width: 390, height: 844 } } },
  ]),
  use: { baseURL: 'http://127.0.0.1:4173/phonebooks/', headless: true },
  webServer: [{ command: 'npm run build -- --base /phonebooks/ && npm run preview -- --base /phonebooks/', url: 'http://127.0.0.1:4173/phonebooks/', reuseExistingServer: false, timeout: 90000 }, { command: 'python3 -m http.server 4174 --bind 127.0.0.1', url: 'http://127.0.0.1:4174/backup/original-build/', reuseExistingServer: false }],
});
