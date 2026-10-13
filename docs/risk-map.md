# Risk-to-test map

This map was written before any tests. Every row is now covered by a suite; the layer column says which. For each thing that could go wrong in ClaimPay, it records what it would cost and the cheapest layer that will catch it reliably. A check goes in the UI suite only when the risk is about what a person actually sees or does. Everything else sits lower, where it's faster and less brittle.

Rule references point to [business-rules.md](business-rules.md).

| # | Risk | If we miss it | Layer | What the check does | Rule |
|---|---|---|---|---|---|
| R1 | A member sees someone else's claim | Privacy breach | API, plus one UI check | API: another member's claim is 404 and the body is identical to a missing claim's; lists are filtered; members get 403 on adjuster routes. UI: a member's list shows only their own claims, before and after switching accounts. | §3 |
| R2 | A bad claim gets accepted | Bad data flows downstream into payments | Unit, API for every boundary, one UI check for the error message | Billed amount 0, 1, 10,000,000 and 10,000,001 cents; service date tomorrow, today, 365 and 366 days ago; impossible dates; unknown procedure code; inactive member. Each at the unit layer and through the API. | §4 |
| R3 | A claim moves to a status it shouldn't | Paying a denied claim, re-opening a paid one | Unit (transition table) and API | Unit: all 25 from/to pairs. API: all 20 reachable pairs through the real endpoints, with the row's status checked after each. | §5 |
| R4 | Payment amount is wrong | Over- or underpaying members | Unit for the formula, API + database for the saved value, two UI checks | Unit: all 13 worked examples, read from the rules document. API: the same 13 end to end, reading the payment row. UI: rows 3 and 9 on screen. Planted defect confirmed caught at every layer. | §6 |
| R5 | A retried payment pays twice | Double payout | API + database | Same key twice: 201 then 200, same payment, one row. Five concurrent with one key: one row. Same key on two claims, racing: 201 + 422. Paid claim with a new key: 409. | §7 |
| R6 | The UI and the API drift apart | Screens break after a backend change | Contract | Consumer tests run the UI's real API client; provider verification replays the contract against the app (done). One deliberate breaking change was shown failing; see README. | — |
| R7 | The main user journey breaks | Members can't submit claims or see decisions | UI (small set) | Member submits a claim; decisions and payments are set up through the API; member sees the outcome and the amount. Adjuster decides and pays through the dialog (done). | §4–7 |
| R8 | Accessibility regressions | Some users can't use the app | UI (axe) plus a written manual check | axe on five page states, tab order and 320px reflow in the suite (done); manual checks and gaps in docs/accessibility.md (done). | — |
| R9 | A failure can't be traced | Slow, guesswork debugging | Built into every layer | Every failing Playwright test attaches the page's API calls with their correlation IDs (done); one ID leads from the browser to the log line to the row. | §8 |

## What's deliberately not covered

- Load and performance. That comes later, in a separate stage, with its own documented workload.
- Security testing beyond access rules (R1). No scanning or penetration testing.
- Browser coverage beyond Chromium in CI. Firefox and WebKit will be runnable locally, but they won't be part of the gate.

These are listed so nobody assumes they're covered.
