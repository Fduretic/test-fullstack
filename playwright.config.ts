import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
const runtime = JSON.parse(readFileSync('.local/runtime.json', 'utf8'));
export default defineConfig({
  testDir: './tests/browser', timeout: 45_000, expect: { timeout: 10_000 },
  fullyParallel: false, workers: 1, reporter: [['list']],
  use: { baseURL: runtime.albumchecka.base, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1100 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
