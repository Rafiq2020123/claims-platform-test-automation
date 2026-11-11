# Stage 2 check record

Stage 2 added `release-check/`: a Python command that checks a running ClaimPay through its API
and reconciles what is stored in its database against `docs/business-rules.md`, in SQL. This
is what was checked before calling it done. "Not tested" means exactly that.

Last updated 2026-11-11, at PR 17. Evidence for the CI rows is
[this run](https://github.com/Rafiq2020123/claims-platform-test-automation/actions/runs/43083528710/job/130741925120).

| # | Check | How | Result |
|---|---|---|---|
| 1 | The command passes on a healthy build | CI job `Release check (Python + SQL)`: migrate, seed, start the app, run `claimpay-release-check` with the database URL | **Passed.** 18 of 18: 9 API checks, 9 reconciliation checks. Exit 0. |
| 2 | The same command fails on a bad build, for the right reason | Same job, app restarted with `DEMO_DEFECT=payment-rounding`; `scripts/expect-defect-caught.py` requires exit 1 and an exact set of failing checks | **Passed.** Exactly 3 fail: the two worked examples at the API (669 vs 670, 2254 vs 2255) and the stored-amount reconciliation. The other 15 pass. Anything more or fewer fails the job. |
| 3 | Expected values are independent of the app | The API checks read the worked examples from the rules document at run time. The SQL recomputes each payment from the claim's approved amount and the `plans` table, not from the payment row. The plan table is itself compared with the document first. | **Passed.** `tests/test_rules.py` also runs the truncation mutation: rows 3, 4, 9, 10 and 11 come out a cent short. |
| 4 | Each reconciliation check catches the record it is for | `tests/test_reconcile.py` plants one bad record per test inside a transaction and rolls back: payment a cent short, PAID claim with no payment, payment on an unpaid claim, history with a step missing, history that stops before the current status, changed plan table. One test plants a correct record and expects no finding. | **Passed.** 7 of 7 in CI, against a real PostgreSQL 16. Planted rows left behind: 0 (checked locally after a run). |
| 5 | A failure can be traced | Every failed check prints the correlation ID of the request, or the one saved on the row | **Passed locally.** With the defect on, the printed ID found the payment request in the server log. In CI the app log is uploaded with the results but nothing asserts on it: **not tested in CI**. |
| 6 | "Could not run" is told apart from "failed" | App unreachable; rules file missing | **Passed locally.** Exit 2 in both cases, with the reason on stderr. Database unreachable also maps to exit 2 in the code; that path was **not tested**. |
| 7 | It found something real | First run of the reconciliation against a database that had been used for earlier demos | **Yes.** Two payments a cent short, written weeks earlier while the defect switch was on. The app was healthy again and the API checks passed on the same run. |
| 8 | Lint and format | `ruff check` and `ruff format --check`, in the CI job | **Passed.** The first CI run of the job failed here: from the repo root ruff sorted the package's own imports as third-party. Fixed by declaring it first-party. |

## What Stage 2 does not cover

- It creates throwaway members through the API and leaves them. There is no delete endpoint. Fine
  for a demo or a staging environment; not something to point at production as is.
- The reconciliation reads the whole `claims` and `payments` tables. No paging, no time window.
  At this size each query takes a few milliseconds; at real volumes it would need both.
- "Exactly one payment per PAID claim" can only ever fail as zero here, because
  `payments.claim_id` is UNIQUE. The check stays because it states the rule and constraints get
  dropped.
- The new job is not yet a required check on `main`. Until it is added to branch protection it
  runs on every pull request but does not block a merge.
- Three API cases suggested in the third review (another member reading a payment, two different
  keys racing to pay one claim, rollback after a failure mid-transaction) are still open.
