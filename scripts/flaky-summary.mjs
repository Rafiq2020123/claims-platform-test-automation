// Reads Playwright's JSON report and lists every test that passed only on retry, so a flaky
// test is visible on the CI run page without opening the HTML artifact. Exits 0 either way:
// surfacing is the job here, the quarantine policy in CONTRIBUTING.md decides what happens next.

import { readFileSync, appendFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2] ?? 'test-results/results.json', 'utf8'));
const flaky = [];
const walk = (suite, path) => {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status === 'flaky')
        flaky.push(`${[...path, spec.title].join(' › ')} (${test.projectName})`);
    }
  }
  for (const child of suite.suites ?? []) walk(child, [...path, child.title]);
};
for (const suite of report.suites ?? []) walk(suite, [suite.title]);

const lines =
  flaky.length === 0
    ? ['### Playwright: no flaky tests']
    : ['### Playwright: flaky tests (passed only on retry)', '', ...flaky.map((t) => `- ${t}`)];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
