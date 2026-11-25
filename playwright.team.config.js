import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/team-browser',
  timeout: 90_000,
  workers: 2,
  projects: [
    { name: 'team-chromium', use: { browserName: 'chromium' } },
    { name: 'team-firefox', use: { browserName: 'firefox' } },
    { name: 'team-iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  use: {
    baseURL: 'https://127.0.0.1:4398',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run build:team && node tests/support/team-stand.js',
      url: 'https://127.0.0.1:4398/__test/ready',
      ignoreHTTPSErrors: true,
      timeout: 90_000,
    },
    {
      command: 'npm run build && npm run preview -- --host localhost --port 4397 --strictPort',
      env: { VITE_PHONEBOOKS_TEAM_URL: 'https://127.0.0.1:4398' },
      url: 'http://localhost:4397',
      timeout: 90_000,
    },
  ],
});
