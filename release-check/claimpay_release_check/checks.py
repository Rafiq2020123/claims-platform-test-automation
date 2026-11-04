"""The release checks: what has to be true of a deployed ClaimPay before anyone calls it good.

Each check is a function that either returns quietly or raises `Failed` with a plain-English
reason and the correlation ID of the request that proved it. The runner turns that into a
`CheckResult`. Checks that create data use a throwaway member named after the run, so they
never touch real accounts and two runs never collide.

What these are not: a second copy of the API test suite. The suite proves the code; this proves
an environment. So the checks are the ones a release engineer would actually run against
staging: the app answers, the seeded accounts work, one claim goes end to end and pays the
amount the written rules say, replaying a payment doesn't pay twice, and the access rules hold.
"""

from __future__ import annotations

import os
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

from .api import Api, Response, Unreachable
from .rules import Plan, WorkedExample

ADJUSTER = "adjuster@claimpay.test"
SEEDED_MEMBERS = ("silver.member@claimpay.test", "gold.member@claimpay.test")


class Failed(Exception):
    def __init__(self, reason: str, response: Response | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.correlation_id = response.correlation_id if response else None


@dataclass
class Context:
    api: Api
    plans: dict[str, Plan]
    examples: list[WorkedExample]
    seed_password: str = field(default_factory=lambda: os.environ.get("SEED_PASSWORD", "claimpay-demo"))
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    today: str = ""
    adjuster_token: str = ""

    def member_email(self, label: str) -> str:
        return f"release-check.{self.run_id}.{label}@claimpay.test"


@dataclass(frozen=True)
class CheckResult:
    name: str
    passed: bool
    seconds: float
    reason: str = ""
    correlation_id: str | None = None


def expect(response: Response, status: int, what: str) -> Response:
    if response.status != status:
        raise Failed(f"{what}: expected HTTP {status}, got {response.status} {response.body}", response)
    return response


# ---------- the checks ----------


def app_answers(ctx: Context) -> None:
    r = expect(ctx.api.health(), 200, "GET /api/health")
    if r.field("status") != "ok":
        raise Failed(f"health status is {r.field('status')!r}, not 'ok'", r)
    today = r.field("today")
    try:
        date.fromisoformat(today)
    except (TypeError, ValueError):
        raise Failed(f"health 'today' is not a date: {today!r}", r) from None
    ctx.today = today


def seeded_accounts_sign_in(ctx: Context) -> None:
    for email in (ADJUSTER, *SEEDED_MEMBERS):
        r = expect(ctx.api.sign_in(email, ctx.seed_password), 200, f"sign in as {email}")
        if not r.field("token"):
            raise Failed(f"sign in as {email} returned no token", r)
        if email == ADJUSTER:
            if r.field("user", "role") != "adjuster":
                raise Failed(f"{email} signed in with role {r.field('user', 'role')!r}", r)
            ctx.adjuster_token = r.field("token")


def wrong_password_gives_nothing_away(ctx: Context) -> None:
    wrong = expect(ctx.api.sign_in(SEEDED_MEMBERS[0], "not-the-password"), 401, "wrong password")
    unknown = expect(ctx.api.sign_in(f"nobody.{ctx.run_id}@claimpay.test", "x"), 401, "unknown email")
    # Compare the error, not the whole body: every response carries its own correlation ID.
    if wrong.field("error") != unknown.field("error"):
        raise Failed("a wrong password and an unknown email get different errors", unknown)


def procedure_codes_published(ctx: Context) -> None:
    r = expect(ctx.api.procedure_codes(), 200, "GET /api/procedure-codes")
    codes = r.body if isinstance(r.body, list) else []
    if not codes:
        raise Failed("the procedure code list is empty", r)
    bad = [c for c in codes if not (isinstance(c, dict) and c.get("code") and c.get("description"))]
    if bad:
        raise Failed(f"{len(bad)} procedure codes have no code or description", r)


def _enrol_and_sign_in(ctx: Context, label: str, plan: str) -> str:
    email = ctx.member_email(label)
    password = f"rc-{uuid.uuid4().hex}"
    expect(ctx.api.enrol(ctx.adjuster_token, email, password, plan), 201, f"enrol {email}")
    r = expect(ctx.api.sign_in(email, password), 200, f"sign in as {email}")
    return r.field("token")


def _first_procedure_code(ctx: Context) -> str:
    codes = ctx.api.procedure_codes().body
    return codes[0]["code"]


def claim_pays_the_documented_amount(ctx: Context, example: WorkedExample) -> None:
    """One claim through the whole journey, for one worked example from the rules: the amount
    that comes out must be the one in the table, not whatever the app computed."""
    member = _enrol_and_sign_in(ctx, f"row{example.row}", example.plan)
    code = _first_procedure_code(ctx)
    claim = expect(
        ctx.api.submit_claim(member, code, ctx.today, example.approved_cents), 201, "submit claim"
    )
    claim_id = claim.field("id")
    decided = expect(
        ctx.api.decide(
            ctx.adjuster_token, claim_id, {"decision": "APPROVE", "approvedCents": example.approved_cents}
        ),
        200,
        "approve claim",
    )
    if decided.field("status") != "APPROVED":
        raise Failed(f"after approval the claim is {decided.field('status')!r}", decided)
    paid = expect(ctx.api.pay(ctx.adjuster_token, claim_id, f"rc-{uuid.uuid4()}"), 201, "record payment")
    amount = paid.field("amountCents")
    if amount != example.payment_cents:
        raise Failed(
            f"worked example row {example.row} ({example.plan}, approved {example.approved_cents}): "
            f"paid {amount} cents, rules say {example.payment_cents} ({example.why})",
            paid,
        )
    seen = expect(ctx.api.payment(member, claim_id), 200, "member reads the payment")
    if seen.field("amountCents") != amount:
        raise Failed(f"member sees {seen.field('amountCents')} cents, adjuster recorded {amount}", seen)
    after = expect(ctx.api.claim(member, claim_id), 200, "member reads the claim")
    if after.field("status") != "PAID":
        raise Failed(f"after payment the claim is {after.field('status')!r}, not PAID", after)


def replaying_a_payment_does_not_pay_twice(ctx: Context) -> None:
    example = next(e for e in ctx.examples if e.payment_cents > 0)
    member = _enrol_and_sign_in(ctx, "replay", example.plan)
    code = _first_procedure_code(ctx)
    claim_id = expect(
        ctx.api.submit_claim(member, code, ctx.today, example.approved_cents), 201, "submit claim"
    ).field("id")
    expect(
        ctx.api.decide(ctx.adjuster_token, claim_id, {"decision": "APPROVE", "approvedCents": example.approved_cents}),
        200,
        "approve claim",
    )
    key = f"rc-{uuid.uuid4()}"
    first = expect(ctx.api.pay(ctx.adjuster_token, claim_id, key), 201, "first payment")
    again = expect(ctx.api.pay(ctx.adjuster_token, claim_id, key), 200, "same key again")
    if again.field("id") != first.field("id"):
        raise Failed("replaying the same Idempotency-Key returned a different payment", again)
    fresh = ctx.api.pay(ctx.adjuster_token, claim_id, f"rc-{uuid.uuid4()}")
    if fresh.status != 409:
        raise Failed(f"a new key on a paid claim got HTTP {fresh.status}, expected 409", fresh)
    expect(ctx.api.pay(ctx.adjuster_token, claim_id, ""), 400, "payment with no Idempotency-Key")


def access_rules_hold(ctx: Context) -> None:
    plan = next(iter(ctx.plans))
    owner = _enrol_and_sign_in(ctx, "owner", plan)
    other = _enrol_and_sign_in(ctx, "other", plan)
    code = _first_procedure_code(ctx)
    claim_id = expect(ctx.api.submit_claim(owner, code, ctx.today, 1000), 201, "submit claim").field("id")

    expect(ctx.api.claim(None, claim_id), 401, "read a claim with no token")
    as_other = ctx.api.claim(other, claim_id)
    missing = ctx.api.claim(other, str(uuid.uuid4()))
    if as_other.status != 404:
        raise Failed(f"another member reading the claim got HTTP {as_other.status}, expected 404", as_other)
    if as_other.field("error") != missing.field("error"):
        raise Failed("another member's claim and a missing claim get different 404 errors", as_other)
    expect(
        ctx.api.decide(owner, claim_id, {"decision": "APPROVE", "approvedCents": 1000}),
        403,
        "member deciding a claim",
    )
    expect(ctx.api.pay(owner, claim_id, f"rc-{uuid.uuid4()}"), 403, "member recording a payment")


def bad_claims_are_refused_with_field_errors(ctx: Context) -> None:
    member = _enrol_and_sign_in(ctx, "validation", next(iter(ctx.plans)))
    code = _first_procedure_code(ctx)
    r = ctx.api.submit_claim(member, code, "2099-01-01", 0)
    if r.status != 400:
        raise Failed(f"a future date and a zero amount got HTTP {r.status}, expected 400", r)
    fields = r.field("error", "fields") or {}
    for name in ("serviceDate", "billedCents"):
        if name not in fields:
            raise Failed(f"validation error names {sorted(fields)}, missing {name}", r)
    if not r.correlation_id:
        raise Failed("the error response carries no X-Correlation-Id header", r)


# ---------- the runner ----------

Check = tuple[str, Callable[[Context], None]]


def all_checks(ctx: Context) -> list[Check]:
    # Two worked examples go end to end: the SILVER and GOLD rows that catch a rounding bug.
    # Both would be one cent short under truncation; one of them is exactly .5.
    rounding_rows = [e for e in ctx.examples if e.row in (3, 9)]
    return [
        ("app answers and knows the date", app_answers),
        ("seeded accounts sign in", seeded_accounts_sign_in),
        ("wrong password gives nothing away", wrong_password_gives_nothing_away),
        ("procedure codes are published", procedure_codes_published),
        *[
            (
                f"claim pays the documented amount (row {e.row}, {e.plan} {e.approved_cents} -> {e.payment_cents})",
                lambda ctx, e=e: claim_pays_the_documented_amount(ctx, e),
            )
            for e in rounding_rows
        ],
        ("replaying a payment does not pay twice", replaying_a_payment_does_not_pay_twice),
        ("access rules hold", access_rules_hold),
        ("bad claims are refused with field errors", bad_claims_are_refused_with_field_errors),
    ]


def run(ctx: Context, checks: list[Check] | None = None) -> list[CheckResult]:
    """Run every check, in order, and keep going after a failure. Only `Unreachable` stops the
    run: once the app is gone there is nothing left to learn."""
    results: list[CheckResult] = []
    for name, check in checks or all_checks(ctx):
        started = time.perf_counter()
        try:
            check(ctx)
            results.append(CheckResult(name, True, time.perf_counter() - started))
        except Failed as failure:
            results.append(
                CheckResult(name, False, time.perf_counter() - started, failure.reason, failure.correlation_id)
            )
        except Unreachable:
            raise
    return results
