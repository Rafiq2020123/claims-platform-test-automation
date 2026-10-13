// Lists failed tests from Playwright's JSON report in the job summary. Used by the planted-defect
// demo so the run page shows exactly which tests caught it.

import { readFileSync, appendFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2] ?? 'test-results/results.json', 'utf8'));
const failed = [];
const walk = (suite, path) => {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status === 'unexpected') {
        const last = test.results.at(-1);
        const error = last?.error?.message?.split('\n').slice(0, 3).join(' ') ?? '';
        failed.push(`- ${[...path, spec.title].join(' › ')}\n  ${error}`);
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
};
for (const suite of report.suites ?? []) walk(suite, [suite.title]);

const { expected = 0, unexpected = 0, flaky = 0 } = report.stats ?? {};
const lines = [
  `### Playwright: ${expected} passed, ${unexpected} failed, ${flaky} flaky`,
  '',
  ...(failed.length ? failed : ['No failures.']),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
