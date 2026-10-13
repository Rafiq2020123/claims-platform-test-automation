# claims-platform-test-automation

Test automation for ClaimPay, a small made-up healthcare claims and payments app that lives in this repo. The app is the thing under test; the tests and the decisions behind them are the point.

**Status:** being built in stages. This README only describes what exists today and will grow as each stage lands.

## What's here now

| Path | What it is |
|---|---|
| [docs/business-rules.md](docs/business-rules.md) | The rules the app must follow, including a hand-calculated table of payment amounts that the tests use as expected results |
| [docs/risk-map.md](docs/risk-map.md) | What could go wrong, what it would cost, and which test layer covers it |
| [docs/ai-log.md](docs/ai-log.md) | How AI tools were used on this repo |

## Coming next

The app itself (API, database, web UI), then unit, contract and Playwright tests, then the CI pipeline. Each lands as its own pull request.

## License

MIT
