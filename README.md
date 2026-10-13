# claims-platform-test-automation

Test automation for ClaimPay, a small made-up healthcare claims and payments app that lives in this repo. The app is the thing under test; the tests and the decisions behind them are the point.

**Status:** being built in stages. This README only describes what exists today and will grow as each stage lands.

## Run it

You need Docker.

```bash
docker compose up --build
```

The app comes up on http://localhost:3000. The API is under `/api`; `/api/health` is a quick check.

Demo accounts (password `claimpay-demo`): `adjuster@claimpay.test`, `silver.member@claimpay.test`, `gold.member@claimpay.test`.

To run the app outside Docker against a local Postgres, copy `.env.example` to `.env`, then `npm ci`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`.

## What's here now

| Path | What it is |
|---|---|
| [docs/business-rules.md](docs/business-rules.md) | The rules the app must follow, including a hand-calculated table of payment amounts that the tests use as expected results |
| [docs/risk-map.md](docs/risk-map.md) | What could go wrong, what it would cost, and which test layer covers it |
| [app/src](app/src) | The ClaimPay API: Node, TypeScript, Fastify, PostgreSQL |
| [app/public](app/public) | The web UI: one page of plain HTML, CSS and JavaScript, no framework. Member and adjuster views. |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | CI: typecheck, lint, format check, and a Docker start-up check on every pull request |
| [docs/ai-log.md](docs/ai-log.md) | How AI tools were used on this repo |

## API

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/api/health` | anyone | Status and the server's date (used for service-date rules) |
| POST | `/api/session` | anyone | Sign in, returns a bearer token |
| GET | `/api/procedure-codes` | anyone | The published procedure code list |
| POST | `/api/members` | adjuster | Enroll a member |
| POST | `/api/claims` | member | Submit a claim |
| GET | `/api/claims` | member, adjuster | Members see their own; adjusters see all |
| GET | `/api/claims/:id` | member, adjuster | One claim |
| POST | `/api/claims/:id/decision` | adjuster | `APPROVE`, `DENY` or `PEND` |
| POST | `/api/claims/:id/payment` | adjuster | Record payment; requires `Idempotency-Key` |
| GET | `/api/claims/:id/payment` | member, adjuster | The payment for a paid claim |

Every response carries an `X-Correlation-Id` header. Send your own to follow a request through the logs.

## The UI

Two roles, one page. A member signs in, submits claims and sees decisions and payments. An adjuster sees the queue, decides claims and records payments. It is written to be accessible first: real labels, field errors tied to their inputs, focus moved to the first problem, a live region for results, keyboard-reachable everything. The UI's only path to the API is [app/public/api-client.js](app/public/api-client.js), which is what the contract tests will exercise.

## Coming next

Unit, contract and Playwright tests, then the merge gate. Each lands as its own pull request.

## License

MIT
