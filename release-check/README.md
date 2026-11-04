# claimpay-release-check

The checks a release engineer runs against a deployed ClaimPay before calling it good. Python,
one dependency (`requests`), one command.

```
pip install -e release-check
claimpay-release-check --base-url http://127.0.0.1:3000
```

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

Every failure prints the reason and the correlation ID of the request that proved it, so it
can be followed into the server log and the database row the same way as any other failure
in this repo.

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
mutation that makes rows 3, 4, 9, 10 and 11 a cent short) and the report. The checks
themselves are exercised against the real app, in CI, not mocked.
