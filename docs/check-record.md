# Stage 1 check record

What was checked before calling the first release done, with the command, where it ran, and
the result. "Not tested" means exactly that; it is not a soft pass.

Last updated 2026-10-13, at the commit of PR 10. Every row is re-checked when something it
depends on changes.

| # | Check | How | Result |
|---|---|---|---|
| 1 | Fresh clone works with the documented commands | `git clone`, `npm ci`, `npx playwright install chromium`, `docker compose up -d db`, `npm run db:migrate`, `npm run db:seed`, `npm test` | **Passed in CI** (GitHub's runner is a fresh machine every time). **On Windows** (Rafiq's machine, Node 24, PowerShell): `npm ci` and `npm run test:unit` pass, 90/90, including the worked-examples parse that read 0 rows before the CRLF fix. Two things it found that weren't bugs in the repo: Node 18 was installed (the project needs 22+, now said in the README), and PowerShell's script policy blocks `npm.ps1` (`npm.cmd` works). API, contract and Playwright layers **not yet run on Windows**; they need a database. |
| 2 | Healthy build: every suite green | CI on `main` | **Passed.** Unit 90, API 69, contract 9 + provider verification, Playwright 18. |
| 3 | Planted defect caught, for the right reason | Playwright against `DEMO_DEFECT=payment-rounding` | **Passed.** Exactly 2 of 18 fail, with `$22.54` and `$6.69` in place of `$22.55` and `$6.70`. Both are amount assertions, not setup. Run locally; the on-demand workflow `Demo - planted defect` records the same on GitHub. |
| 4 | Merge gate: a failing check actually blocks a merge | Ruleset on `main` with the six CI jobs required | **Not yet.** The repo is public as of PR 10, so this is now possible; the ruleset is being set up and a blocked merge will be recorded here. Until then, CI runs but does not block. |
| 5 | Flaky handling: a pass on retry is visible as flaky | `scripts/flaky-summary.mjs` on the JSON report, in the job summary | **Passed.** Script verified on a real report with a status edited to `flaky`; the test appears by name. No real flaky test has occurred in 8 full CI runs. |
| 6 | Parallel runs don't collide | 5 consecutive runs, 4 workers, fresh members per test | **Passed.** 85/85. |
| 7 | Tests wait on state, not time | Playwright against `DEMO_LATENCY_MS=400` | **Passed.** 18/18, no failures. |
| 8 | Expected values are independent of the app | Unit and API tests parse the worked-examples table from `docs/business-rules.md` | **Passed.** Also mutation-checked: truncation → 5 unit failures; illegal transition allowed → 2. |
| 9 | Contract catches a breaking change | Renamed the `fields` key on the provider; changed the client's auth scheme to `Basic` | **Passed** both ways. Verification failed naming the key; the consumer test failed naming the header pattern. Both reverted. |
| 10 | Concurrency: same key, same claim ×5; same key, two claims | `tests/api/payments.test.ts`; advisory lock removed by hand to see which test notices | **Passed.** One row, identical bodies, claim PAID; 201 + 422, winner PAID, loser still APPROVED. With the lock removed the two-claim race fails (500), the ×5 case did not on that run. The two-claim test is the one that pins the lock. |
| 11 | README and docs claim nothing that doesn't run | Read through at each PR; Codex checkpoint 2 found four doc claims that overstated the code (R2 coverage, quarantine, the Pact decision, the investigation's failure count), all corrected | **Passed** as of PR 9. Items that aren't done are marked so, here and in the risk map. |
| 12 | Failing test can be followed to the row | Investigation 001 | **Passed locally.** In CI the server log isn't captured as a file, so the log step of the chain is **not tested in CI**. |
| 13 | Public report link that works signed out | GitHub Pages | **Not yet.** Possible now the repo is public. The report is a CI artifact for now (30 days). |
| 14 | Manual accessibility pass | `docs/accessibility.md` | **Passed** for keyboard, focus, errors, zoom, reflow, contrast. **Not tested:** screen readers, high-contrast mode. |
| 15 | No secrets, no employer data | `git grep` for keys and names; `.env` ignored | **Passed.** The only secrets are the documented demo defaults, bound to localhost. |
| 16 | Rafiq can change a test, explain the oracle, diagnose the demo failure | Walkthrough | **Not yet done.** Scheduled before the repo goes public. |

## Order of remaining work

1. Ruleset and a recorded blocked merge (#4), then Pages (#13).
2. Walkthrough (#16).
3. The rest of #1 on Windows (API, contract, Playwright) once Docker is set up there. Not blocking: CI covers these layers on every run.
