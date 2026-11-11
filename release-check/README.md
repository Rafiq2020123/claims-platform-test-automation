# claimpay-release-check

The checks a release engineer runs against a deployed ClaimPay before calling it good. Python,
two dependencies (`requests`, `psycopg`), one command.

```
pip install -e release-check
claimpay-release-check --base-url http://127.0.0.1:3000 --database-url postgres://...
```

Two layers. The API checks prove the running app answers correctly for a few new claims. The
reconciliation checks read every claim and payment already in the database and ask whether the
written rules hold for all of them. Both report the same way; `--database-url` (or
`$DATABASE_URL`) turns the second layer on, `--no-api` runs only that layer.

Exit code `0`: every check passed. `1`: at least one failed; do not release. `2`: the checks
could not run (app unreachable, rules file not found); fix the check, not the build.

## What it checks

| Check | What it proves |
|---|---|
| app answers and knows the date | `/api/health` is up and the service-date rules have a clock |
| seeded accounts sign in | the adjuster and both demo members exist and the seed password works |
| wrong password gives nothing away | a wrong password and an unknown email get the same 401 |
| procedure codes are published | the list the UI depends on is not empty or malformed |
| claim pays the documented amount (two rows) | a claim goes submit → approve → pay and the amount is the one in `docs/business-rules.md`, read at run time. Rows 3 and 9 are used because both come out a cent short if the app truncates instead of rounding half up |
| replaying a payment does not pay twice | same key twice → 201 then 200 with the same payment; new key on a paid claim → 409; no key → 400 |
| access rules hold | no token → 401; another member's claim → 404 with the same error as a missing one; a member cannot decide or pay |
| bad claims are refused with field errors | a bad claim gets a 400 that names the fields, with a correlation ID |

## What it reconciles

Each is one SQL query that returns the rows breaking the rule. The expected payment is
recomputed from the claim's approved amount and the member's plan in the `plans` table, never
read from the payment row, so the data is checked against the rules and not against itself.

| Check | Rule |
|---|---|
| plans table matches the rules document | runs first: if the plan terms are wrong, every expected amount would be wrong with them |
| every payment is the amount the rules give | section 6, `max(0, floor((approved x bp + 5000) / 10000) - copay)` |
| a payment's recorded inputs match the claim and the plan | the snapshot on the payment row equals the claim's approved amount and the plan's terms |
| every PAID claim has exactly one payment | section 7 |
| no payment exists for a claim that is not PAID | section 7 |
| approved and paid claims carry a valid approved amount; denied claims carry a reason | section 5 |
| the last status in a claim's history is its current status | section 8 |
| every status change in the history is an allowed move, in an unbroken chain | section 5, the allowed-moves table |
| every claim has a history | section 8 |

Every failure, API or database, prints the reason and the correlation ID of the request that
wrote the row, so it can be followed into the server log the same way as any other failure in
this repo.

The first time the reconciliation ran here it found two payments a cent short. They were
written three weeks earlier, by a run of the API checks against the app with the planted
rounding defect switched on. The app was healthy again, so the API checks passed; the data it
had written while broken was still wrong. That is the case this layer exists for.

## What it is not

Not a second copy of `tests/api`. That suite proves the code, in-process, against every
boundary. This proves an environment: the deployed app, its database, its seed, its config.
It creates its own throwaway members (`release-check.<run>.<label>@claimpay.test`) and leaves
them; there is no delete endpoint, and a release check that deletes data would be a worse idea
than one that leaves a few test accounts behind.

## Running it here

```
docker compose up --build        # or npm run dev against a local Postgres
pip install -e release-check
claimpay-release-check
```

With the planted defect on (`DEMO_DEFECT=payment-rounding`), exactly the two amount checks fail:

```
  FAIL  claim pays the documented amount (row 3, SILVER 3337 -> 670)  (113 ms)
        worked example row 3 (SILVER, approved 3337): paid 669 cents, rules say 670 (Rounds up)
        correlation id: release-check-e5b773bf-71ac-4873-914e-7127a7b92d38
```

## Its own tests

```
cd release-check && pip install -e ".[dev]" && python -m pytest
```

They cover the rules parser and the formula (all 13 worked examples, and the truncation
mutation that makes rows 3, 4, 9, 10 and 11 a cent short), the report, and the reconciliation
checks against a real database: with `DATABASE_URL` set, each test plants a bad record inside
a transaction (a payment a cent short, a PAID claim with no payment, a payment on an unpaid
claim, a history with a step missing, a history that stops before the current status, a
changed plan table), asserts the right check names the right row, and rolls back. Without
`DATABASE_URL` those tests are skipped and say so. The API checks themselves are exercised
against the real app, in CI, not mocked.
