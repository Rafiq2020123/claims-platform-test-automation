import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: 'tests/e2e/specs',
  fullyParallel: true,
  // A retry is a diagnostic, not a fix. CI gets one so a transient failure doesn't block a
  // merge; locally there are none, so a flaky test is seen the first time it flakes. The report
  // marks a test that passed on retry as "flaky", never "passed".
  retries: CI ? 1 : 0,
  workers: CI ? 4 : undefined,
  forbidOnly: CI,
  reporter: CI
    ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Not part of the CI gate. Run with: npx playwright test --project=firefox
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node --env-file-if-exists=.env --import tsx app/src/main.ts',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !CI,
    timeout: 30_000,
  },
});
