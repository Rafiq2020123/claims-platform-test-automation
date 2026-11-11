"""The reconciliation checks against a real database, with bad records planted inside a
transaction that is rolled back at the end. Nothing is left behind, and the checks run on the
same connection so they see the uncommitted rows.

Needs DATABASE_URL (migrated and seeded). Skipped otherwise, and says so."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

from claimpay_release_check.checks import Failed
from claimpay_release_check.reconcile import run_reconciliations
from claimpay_release_check.rules import find_rules_file, load_rules

DATABASE_URL = os.environ.get("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set; reconciliation tests need a database")


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL) as c:  # type: ignore[arg-type]
        yield c
        c.rollback()


@pytest.fixture(scope="module")
def plans():
    rules = find_rules_file(Path(__file__).resolve())
    assert rules is not None
    return load_rules(rules)[0]


def checks_by_name(conn, plans):
    return dict(run_reconciliations(conn, plans))


def failure_of(check) -> Failed:
    with pytest.raises(Failed) as caught:
        check()
    return caught.value


def plant_paid_claim(conn, *, plan: str, approved: int, amount: int) -> tuple[str, str]:
    """Insert a member, a PAID claim with a clean history, and its payment, exactly as the app
    would, except the amount is whatever the test says. Returns (claim_id, payment_id)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT id FROM users WHERE role = 'adjuster' LIMIT 1")
        adjuster = cur.fetchone()["id"]
        cur.execute("SELECT coverage_bp, copay_cents FROM plans WHERE code = %s", (plan,))
        terms = cur.fetchone()
        cur.execute("SELECT code FROM procedure_codes LIMIT 1")
        code = cur.fetchone()["code"]
        cur.execute(
            """INSERT INTO users (email, full_name, role, plan_code, password_hash)
               VALUES (%s, 'Planted Member', 'member', %s, 'x') RETURNING id""",
            (f"planted.{uuid.uuid4().hex[:8]}@claimpay.test", plan),
        )
        member = cur.fetchone()["id"]
        cid = f"planted-{uuid.uuid4()}"
        cur.execute(
            """INSERT INTO claims (member_id, procedure_code, service_date, billed_cents, status,
                                   approved_cents, correlation_id)
               VALUES (%s, %s, current_date, %s, 'PAID', %s, %s) RETURNING id""",
            (member, code, approved, approved, cid),
        )
        claim = cur.fetchone()["id"]
        for from_status, to_status in ((None, "SUBMITTED"), ("SUBMITTED", "APPROVED"), ("APPROVED", "PAID")):
            cur.execute(
                """INSERT INTO claim_status_history (claim_id, from_status, to_status, changed_by, correlation_id)
                   VALUES (%s, %s, %s, %s, %s)""",
                (claim, from_status, to_status, adjuster, cid),
            )
        cur.execute(
            """INSERT INTO payments (claim_id, idempotency_key, amount_cents, approved_cents,
                                     coverage_bp, copay_cents, recorded_by, correlation_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (claim, f"planted-{uuid.uuid4()}", amount, approved, terms["coverage_bp"], terms["copay_cents"], adjuster, cid),
        )
        return str(claim), str(cur.fetchone()["id"])


def test_a_correct_payment_passes_every_check(conn, plans):
    # Row 9 of the worked examples: GOLD, 2505 -> 2255.
    plant_paid_claim(conn, plan="GOLD", approved=2505, amount=2255)
    for name, check in checks_by_name(conn, plans).items():
        try:
            check()
        except Failed as failure:
            # The local database may hold leftovers from earlier runs with the planted defect
            # on. Those are real findings, but not this test's; only fail on the planted claim.
            assert "planted" not in failure.reason, f"{name}: {failure.reason}"


def test_a_payment_one_cent_short_is_caught_with_its_correlation_id(conn, plans):
    claim, payment = plant_paid_claim(conn, plan="SILVER", approved=3337, amount=669)
    failure = failure_of(checks_by_name(conn, plans)["every payment is the amount the rules give"])
    assert claim in failure.reason and "expected_cents=670" in failure.reason
    # The row's own correlation ID is in the report, so the bad write can be traced. (It is
    # the first row's ID that lands on the result; here that may be an older leftover.)
    assert "correlation_id=planted-" in failure.reason


def test_a_paid_claim_with_no_payment_is_caught(conn, plans):
    claim, payment = plant_paid_claim(conn, plan="GOLD", approved=10000, amount=9000)
    conn.execute("DELETE FROM payments WHERE id = %s", (payment,))
    failure = failure_of(checks_by_name(conn, plans)["every PAID claim has exactly one payment"])
    assert claim in failure.reason and "payments=0" in failure.reason


def test_a_payment_on_an_unpaid_claim_is_caught(conn, plans):
    claim, _ = plant_paid_claim(conn, plan="GOLD", approved=10000, amount=9000)
    conn.execute("UPDATE claims SET status = 'APPROVED' WHERE id = %s", (claim,))
    failure = failure_of(checks_by_name(conn, plans)["no payment exists for a claim that is not PAID"])
    assert claim in failure.reason and "status=APPROVED" in failure.reason


def test_a_history_that_skips_a_step_is_caught(conn, plans):
    claim, _ = plant_paid_claim(conn, plan="GOLD", approved=10000, amount=9000)
    # Remove the APPROVED row: the chain now reads SUBMITTED -> (gap) -> PAID.
    conn.execute(
        "DELETE FROM claim_status_history WHERE claim_id = %s AND to_status = 'APPROVED'", (claim,)
    )
    failure = failure_of(
        checks_by_name(conn, plans)["every status change in the history is an allowed move, in an unbroken chain"]
    )
    assert claim in failure.reason and "from_status does not match the previous row" in failure.reason


def test_a_status_the_history_does_not_end_on_is_caught(conn, plans):
    claim, _ = plant_paid_claim(conn, plan="GOLD", approved=10000, amount=9000)
    conn.execute("DELETE FROM claim_status_history WHERE claim_id = %s AND to_status = 'PAID'", (claim,))
    failure = failure_of(checks_by_name(conn, plans)["the last status in a claim's history is its current status"])
    assert claim in failure.reason and "last_in_history=APPROVED" in failure.reason


def test_a_changed_plan_table_stops_the_amount_check_from_lying(conn, plans):
    # If someone edits the plan terms, every "expected" amount shifts with them. The plan check
    # runs first so that case is reported as what it is, not as a hundred wrong payments.
    conn.execute("UPDATE plans SET copay_cents = 2500 WHERE code = 'SILVER'")
    failure = failure_of(checks_by_name(conn, plans)["plans table matches the rules document"])
    assert "2500" in failure.reason and "2000" in failure.reason
