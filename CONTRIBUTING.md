# Contributing

This is how to go from a fresh checkout to a useful new test, and what to do when one fails.

## 1. Run everything once

You need Node 22+ and either Docker or a local PostgreSQL 16.

```bash
git clone https://github.com/Rafiq2020123/claims-platform-test-automation.git
cd claims-platform-test-automation
npm ci
npx playwright install chromium
```

With Docker, the simplest way to get a database is to start only that service:

```bash
docker compose up -d db
cp .env.example .env        # DATABASE_URL in there already points at it
npm run db:migrate
npm run db:seed
npm test
```

`npm test` runs, in order: unit (no database), API, contract, then Playwright. The Playwright
config starts the app itself. Expect about a minute end to end.

To run one layer: `npm run test:unit`, `test:api`, `test:contract`, `test:e2e`. To run one
Playwright file: `npx playwright test tests/e2e/specs/access.spec.ts`. Add `--ui` to watch it.

## 2. Add a test

Decide the layer first, using [docs/risk-map.md](docs/risk-map.md): a rule about money or
status goes in `tests/unit`; anything about what the API returns or saves goes in `tests/api`;
anything a person sees or does goes in `tests/e2e`. The UI suite is deliberately small.

**Test data.** Never reuse a seeded member in a test that creates claims; create one.
- API tests: `h.member()`, `h.adjuster()`, `h.claim(member, cents)`, `h.approvedClaim(...)`.
- Playwright: the `member` and `goldMember` fixtures give you a fresh member each test;
  `api.submitClaim`, `api.approve`, `api.pay` set up state without touching the UI.

**Expected values.** If the number comes from a rule, take it from the worked-examples table
in `docs/business-rules.md` (`workedExamples()` in `tests/unit/worked-examples.ts`), not from
what the app shows you. If you need a new case, add the row to the document first.

**Locators.** `getByRole`, `getByLabel`, `getByText`. If you can't find an element that way,
the UI is probably not accessible to someone using a screen reader either; fix the markup.
The one exception is `data-claim-id` on table rows.

**Waiting.** Only `expect(locator)` assertions. No `waitForTimeout`. If something seems to need
a sleep, it's a missing assertion on the state you're actually waiting for.

Then: `npm run lint && npm run typecheck && npm run format`, and open a pull request. CI runs
every layer against a real database.

## 3. When a test fails

1. **Read the assertion.** Expected vs received, and which line. Most failures end here.
2. **API or contract test:** the error body includes a `correlationId`. Search the app's log
   for it (`docker compose logs app | grep <id>`) to see the request's path through the server,
   then look at the row: `claims.correlation_id` and `payments.correlation_id` carry the ID of
   the last change.
3. **Playwright test:** open the HTML report (`npx playwright show-report`). A failed test has
   a screenshot, a trace (step by step, with network), and an attachment named
   `api-calls-with-correlation-ids` listing every API call the page made. Pick the one that
   went wrong and follow it as in step 2.
4. **Passed on retry?** In CI, that's reported as *flaky* and listed in the job summary. Don't
   leave it. Reproduce locally with `npx playwright test <file> --repeat-each 20`. If it still
   flakes and the fix isn't quick, quarantine it: tag it `@quarantine`, open an issue with the
   failure, the owner, a review date, and what coverage is lost, and link the issue in the tag's
   comment. Quarantined tests still run but don't block the merge. A test can't stay
   quarantined past its review date without a new decision.

A worked example of step 2 is in [docs/investigations/001-payment-mismatch.md](docs/investigations/001-payment-mismatch.md).

## 4. Changing the app

If you change a rule, change `docs/business-rules.md` in the same pull request. If you change
what the API returns, run the consumer tests: the committed contract in `pacts/` must match, or
CI fails. That's the point.
