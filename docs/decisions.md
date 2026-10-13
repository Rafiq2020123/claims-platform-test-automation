# Decisions

Short records of choices that someone might reasonably have made differently, with the reason.

## The app lives in the same repo as the tests

A change to the app that breaks a test can't be merged without the test being seen. With two
repos, the app could change on its own and the framework repo would only find out later. One
pipeline, one gate.

## Integer cents and basis points, BigInt for the product

Floating point is wrong for money, and the one place it would bite here (approved × rate at the
top of the range) is exactly the place a test would be least likely to try. BigInt costs one
line and removes the question.

## Fixtures over base classes in Playwright

A `member` fixture creates a member when a test asks for one and nothing when it doesn't. A
base class would create one for every test, hide the setup, and make the tests harder to read
in isolation. Fixtures compose; inheritance stacks.

## Test data through the API, not the UI and not the database

The UI route is slow and couples every test to the form. The database route skips the rules the
app enforces, so a test could set up a state the app would never produce. The API is the
narrow path that is fast and honest. The exceptions: the API tests insert users directly,
because the enrolment route is itself under test; and the contract provider inserts rows with
fixed IDs, because the contract names them.

## An advisory lock on the idempotency key

The first version locked the claim row. Two requests with the same key for different claims
locked different rows, both missed the key lookup, and the second one hit the unique index and
returned 500. The alternative was to catch the unique violation after the rollback and turn it
into a 422. The advisory lock is one line, happens before any work, and makes the second request
see the first one's result rather than an error about it.

## Retries: one in CI, none locally, flaky is a status

A retry hides nothing if the report says "flaky" and the job summary lists it. Zero retries in
CI would block merges on a transient network blip; more than one would let a test fail two
times in three and still look fine. Locally, zero: the person running it should see the flake.

## 404, not 403, for another member's claim

A 403 confirms the claim exists. For a members' portal that's an information leak: an ID that
gets 403 is real, one that gets 404 isn't. Both now get the same 404.

## The contract is narrower than the API

Pact records what the UI's client actually reads from each response. The API returns more
(timestamps, member IDs, plan terms on a payment). Checking those in the contract would turn
every harmless addition into a contract failure. The contract fails when the UI would break;
the API tests cover the rest.

## Demo switches are environment variables, off by default, logged loudly when on

The planted defect and the latency are useful for showing the tests catch real problems, and
dangerous if they could be left on by accident. They're not routes, not query parameters, not
headers. They're read once at start-up, and the start-up log says so in a warning.

## No test framework for the unit, API and contract layers

Node's built-in runner does `describe`, `it`, `before`, `after` and assertions. Adding Jest or
Vitest would be a dependency, a config file and a transform pipeline for no capability this
repo uses. Playwright has its own runner because browser tests need it.
