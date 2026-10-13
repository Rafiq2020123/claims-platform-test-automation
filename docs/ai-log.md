# AI usage log

This repo is built with AI assistance. This log records what was used, what it produced, what changed in review, and how the result was checked. Entries are added as the work happens, not written afterwards.

| Date | Tool | What it produced | What changed in review | How it was checked |
|---|---|---|---|---|
| 2026-10-13 | Claude Code | First drafts of business-rules.md, risk-map.md, README and this log, from a spec Rafiq approved | Rafiq reviewed and merged PR 1 without changes | All 13 payment examples recalculated with a separate script before commit; one value (row 4) had been estimated wrong and was corrected |
| 2026-10-13 | Claude Code | The ClaimPay API (PR 2): schema, migrations, seed, routes, Docker setup | Rafiq merged without changes | Every rule in business-rules.md exercised against the running app with a throwaway script (42 checks, including 5 parallel payments sharing one Idempotency-Key). That run found a real bug: an empty JSON body returned 500 instead of 400, because the error handler only passed through schema errors. Fixed before commit. Docker Compose was not run here (image registry blocked in the build environment); first Docker run is Rafiq's. |
| 2026-10-13 | Claude Code | Web UI (PR 3): HTML, CSS, API client, page script; CI workflow | — | Driven through headless Chromium with a throwaway script: both roles end to end, field errors, keyboard order, axe scans on 5 states (0 violations), 320px reflow. Found and fixed: the hidden sign-out button was still in the tab order (a `display: flex` rule beat the `hidden` attribute); tables overflowed the page at 320px. `@fastify/static` first resolved to a version with 4 open advisories; pinned to the patched release. |
