# Investigation 001: payment one cent short

**This is a constructed scenario.** The defect was planted on purpose with
`DEMO_DEFECT=payment-rounding` to show how a failure in this repo is followed from the test
report to the root cause. It is not an incident from any employer or real system.

Date: 2026-10-13. App at the commit of PR 8. Chromium. The IDs below are from one real run.

## Symptom

Two Playwright tests fail, both amount checks, the other 15 pass. This follows the first of the two; the second has the same cause.

```
✘ adjuster queue › approve, then record a payment, and see the computed amount
  Error: expect(locator).toHaveText(expected) failed
  Expected: "Payment of $22.55 recorded."
  Received: "Payment of $22.54 recorded."
```

The test approves a GOLD member's $25.05 claim and records the payment. The rules
(`docs/business-rules.md` §6, worked example row 9) say 2505 × 90% = 2254.5, rounds half up to
2255 cents. The screen says 2254.

## Competing explanations

1. **Test data.** The test used the wrong plan or amount, so the expected value is wrong.
2. **Display.** The payment is right in the database and `formatCents` is off by one.
3. **Calculation.** The server computed 2254.
4. **Copay order.** The copay was subtracted before the rate instead of after (the rules say
   after). GOLD's copay is 0, so this can't produce a 1-cent difference. Ruled out before
   looking at anything.

## Evidence

**From the report.** The failed test's attachment `api-calls-with-correlation-ids` lists every
API call the page made. The payment call:

```
201 POST http://127.0.0.1:3000/api/claims/74989ab6-…/payment 392e8ca3-e059-4f1a-abe7-6e26babb695c
```

**From the server log**, searching for that ID (`grep 392e8ca3 app.log`):

```json
{"level":30,"correlationId":"392e8ca3-…","req":{"method":"POST","url":"/api/claims/74989ab6-…/payment"},"msg":"incoming request"}
{"level":30,"correlationId":"392e8ca3-…","res":{"statusCode":201},"responseTime":5.37,"msg":"request completed"}
```

A 201, no error, 5 ms. The server believed it did the right thing. Also in the log, at
start-up:

```json
{"level":40,"demoDefect":"payment-rounding","msg":"DEMO_DEFECT is on"}
```

That line is the answer, and in a real incident it's the kind of line (a feature flag, a config
difference between environments) that's easy to skip past. Keep going as if it weren't there.

**From the database**, by the same ID:

```sql
SELECT claim_id, amount_cents, approved_cents, coverage_bp, copay_cents
FROM payments WHERE correlation_id = '392e8ca3-…';
-- 74989ab6-… | 2254 | 2505 | 9000 | 0
```

The row says 2254. The inputs on the row are right: approved 2505, rate 9000 bp, copay 0.
Explanation 1 (test data) is out: the inputs match the worked example. Explanation 2
(display) is out: the database already holds 2254. The server computed it. Explanation 3.

```sql
SELECT from_status, to_status, correlation_id FROM claim_status_history
WHERE claim_id = '74989ab6-…' ORDER BY id;
--           | SUBMITTED | c58a3a6a-…
-- SUBMITTED | APPROVED  | dbca13ff-…
-- APPROVED  | PAID      | 392e8ca3-…
```

The history is clean: one submission, one approval, one payment, each with its own request ID.
Nothing was paid twice or re-approved.

## Root cause

`calculatePayment` in `app/src/domain/payment.ts` has two rounding modes. With
`DEMO_DEFECT=payment-rounding` the payment route passes `'truncate'`, which does
`product / BP_PER_WHOLE` with BigInt division and drops the half cent: 2254.5 becomes 2254.
Without the switch the route passes `'half-up'`, which adds half a unit before dividing,
`(product + 5000n) / 10000n`, giving 2255.

## Fix and regression check

For the demonstration, the fix is to run without the switch. The permanent protection is
already in place:

- `tests/unit/payment.test.ts` checks all 13 worked examples against the half-up formula and
  separately asserts that truncation is 1 cent short on rows 3, 4, 9, 10 and 11. If someone
  changed the default rounding, 5 unit tests fail before anything reaches a browser.
- `tests/api/payments.test.ts` checks the same 13 examples through the API and reads the saved
  row, and has a case that starts the app with the defect on and expects exactly the half-cent
  rows to be short.
- The Playwright test that failed here asserts the on-screen amount against row 9.

The unit and API suites don't read the switch from the environment: the unit tests call the
formula directly, and the API harness starts its own app with the switch pinned off, then one
explicit case pins it on. So `DEMO_DEFECT` in the environment changes only the app the
Playwright suite talks to, and there exactly 2 of 17 tests fail (this one and the member's
`Paid $6.70`, row 3). That's what you'd want: the lower layers say what the formula is, and the
UI layer says what the running app did.

## What's still open

The test attachment lists correlation IDs, but following one into the server log is a manual
`grep`. In CI the app's stdout isn't captured as a file, so the "from the server log" step
above can only be done locally or on an environment with log shipping. That's a gap in the
evidence chain for CI runs, recorded in `docs/check-record.md`.
