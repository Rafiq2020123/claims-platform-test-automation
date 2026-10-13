import { defineConfig } from '@playwright/test';
import base, { QUARANTINE } from './playwright.config.js';

// Only the tests tagged @quarantine. Same settings as the main config otherwise. Run by CI in
// a job that reports but never blocks; locally with `npm run test:e2e:quarantine`.
export default defineConfig({
  ...base,
  grep: QUARANTINE,
  grepInvert: undefined,
});
