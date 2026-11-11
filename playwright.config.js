import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173/phonebooks/', headless: true },
  webServer: [{ command: 'npm run build -- --base /phonebooks/ && npm run preview -- --base /phonebooks/', url: 'http://127.0.0.1:4173/phonebooks/', reuseExistingServer: false, timeout: 90000 }, { command: 'python3 -m http.server 4174 --bind 127.0.0.1', url: 'http://127.0.0.1:4174/backup/original-build/', reuseExistingServer: false }],
});
