# AI usage log

This repo is built with AI assistance. This log records what was used, what it produced, what changed in review, and how the result was checked. Entries are added as the work happens, not written afterwards.

| Date | Tool | What it produced | What changed in review | How it was checked |
|---|---|---|---|---|
| 2026-10-13 | Claude Code | First drafts of business-rules.md, risk-map.md, README and this log, from a spec Rafiq approved | Rafiq reviewed and merged PR 1 without changes | All 13 payment examples recalculated with a separate script before commit; one value (row 4) had been estimated wrong and was corrected |
| 2026-10-13 | Claude Code | The ClaimPay API (PR 2): schema, migrations, seed, routes, Docker setup | — | Every rule in business-rules.md exercised against the running app with a throwaway script (42 checks, including 5 parallel payments sharing one Idempotency-Key). That run found a real bug: an empty JSON body returned 500 instead of 400, because the error handler only passed through schema errors. Fixed before commit. Docker Compose was not run here (image registry blocked in the build environment); first Docker run is Rafiq's. |
