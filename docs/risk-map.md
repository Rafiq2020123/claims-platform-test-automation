# Risk-to-test map

This map was written before any tests. For each thing that could go wrong in ClaimPay, it records what it would cost and the cheapest layer that can catch it reliably. A check goes in the UI suite only when the risk is about what a person actually sees or does. Everything else sits lower, where it's faster and less brittle.

Rule references point to [business-rules.md](business-rules.md).

| # | Risk | If we miss it | Layer | What the check does | Rule |
|---|---|---|---|---|---|
| R1 | A member sees someone else's claim | Privacy breach | API, plus one UI check | Request another member's claim by ID and expect 404. In the UI, a member's list shows only their own claims. | §3 |
| R2 | A bad claim gets accepted | Bad data flows downstream into payments | API for every boundary, one UI check for the error message | Billed amount 0, 1, 10,000,000 and 10,000,001 cents; service date tomorrow, exactly 365 days ago, 366 days ago; unknown procedure code; inactive member. | §4 |
| R3 | A claim moves to a status it shouldn't | Paying a denied claim, re-opening a paid one | Unit (transition table) and API | Every illegal from/to pair returns 409. Every legal pair succeeds. | §5 |
| R4 | Payment amount is wrong | Over- or underpaying members | Unit for the formula, API + database for the saved value | All 13 worked examples. The API check also reads the payment row from the database. | §6 |
| R5 | A retried payment pays twice | Double payout | API + database | Send the same payment twice with one Idempotency-Key and expect one row and the same response. Reuse the key on another claim and expect 422. | §7 |
| R6 | The UI and the API drift apart | Screens break after a backend change | Contract | Consumer tests run the UI's real API client. Provider verification runs against the app. One deliberate breaking change is shown failing. | — |
| R7 | The main user journey breaks | Members can't submit claims or see decisions | UI (small set) | Member submits a claim; data for the decision is set up through the API; member sees the decision and payment amount. | §4–7 |
| R8 | Accessibility regressions | Some users can't use the app | UI (axe) plus a written manual check | Automated axe scan of the main pages, plus keyboard, focus, form errors and zoom checked by hand and recorded with what wasn't covered. | — |
| R9 | A failure can't be traced | Slow, guesswork debugging | Built into every layer | The correlation ID is attached to every failing test's report, so one ID leads from the browser to the log line to the row. | §8 |

## What's deliberately not covered

- Load and performance. That comes later, in a separate stage, with its own documented workload.
- Security testing beyond access rules (R1). No scanning or penetration testing.
- Browser coverage beyond Chromium in CI. Firefox and WebKit can be run locally with a flag, but they aren't part of the gate.

These are listed so nobody assumes they're covered.
