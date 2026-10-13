import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// The web server subprocess reads .env through Node's --env-file-if-exists, but the fixtures
// run in this process, which doesn't. Load it here too so SEED_PASSWORD means the same thing
// to the test that signs in as it does to the seed that created the account.
if (existsSync('.env')) process.loadEnvFile('.env');

const CI = !!process.env.CI;
// Tests tagged @quarantine are known-flaky and under review (see CONTRIBUTING). They are kept
// out of this, the gating run; playwright.quarantine.config.ts runs only them, in a CI job
// that can't block a merge.
export const QUARANTINE = /@quarantine/;
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
  grepInvert: QUARANTINE,
  // The HTML report is written locally too, so `npx playwright show-report` after a failure
  // works the way CONTRIBUTING says it does.
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ...(CI ? [['json', { outputFile: 'test-results/results.json' }] as const] : []),
  ],
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
