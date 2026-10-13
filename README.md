# claims-platform-test-automation

Test automation for ClaimPay, a small made-up healthcare claims and payments app that lives in this repo. The app is the thing under test; the tests and the decisions behind them are the point.

**Status:** being built in stages. This README only describes what exists today and will grow as each stage lands.

## Run it

You need Docker.

```bash
docker compose up --build
```

The API comes up on http://localhost:3000. Check it with:

```bash
curl http://localhost:3000/api/health
```

Demo accounts (password `claimpay-demo`): `adjuster@claimpay.test`, `silver.member@claimpay.test`, `gold.member@claimpay.test`.

To run the app outside Docker against a local Postgres, copy `.env.example` to `.env`, then `npm ci`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`.

## What's here now

| Path | What it is |
|---|---|
| [docs/business-rules.md](docs/business-rules.md) | The rules the app must follow, including a hand-calculated table of payment amounts that the tests use as expected results |
| [docs/risk-map.md](docs/risk-map.md) | What could go wrong, what it would cost, and which test layer covers it |
| [app/](app/) | The ClaimPay API: Node, TypeScript, Fastify, PostgreSQL |
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

## Coming next

A web UI, then unit, contract and Playwright tests, then the CI pipeline. Each lands as its own pull request.

## License

MIT
