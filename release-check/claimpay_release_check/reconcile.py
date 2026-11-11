"""Database reconciliation: does what is stored agree with the written rules?

The API checks prove the app answers correctly for a few new claims. This looks at every row
already in the database and asks whether the rules in docs/business-rules.md hold for all of
them. The expected payment is recomputed in SQL from the claim's approved amount and the
member's plan, never read from the payment row; the status history is walked against the
allowed-moves table. Each check is one query that returns the rows that break the rule, so a
failure names the claim or payment, and the correlation ID saved on it, straight away.

Why SQL and not Python over fetched rows: the whole point is to check the data where it lives,
in one pass, in the language the data team will read. Python drives it and reports it.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row

from .checks import CheckResult, Failed
from .rules import Plan

# docs/business-rules.md section 5, "Allowed moves". The first row of any history is
# (NULL -> SUBMITTED). Everything else must be in this list.
ALLOWED_MOVES = (
    ("SUBMITTED", "APPROVED"),
    ("SUBMITTED", "DENIED"),
    ("SUBMITTED", "PENDED"),
    ("PENDED", "APPROVED"),
    ("PENDED", "DENIED"),
    ("APPROVED", "PAID"),
)

DENIAL_REASONS = ("NOT_COVERED", "MISSING_INFORMATION", "DUPLICATE_CLAIM", "OUT_OF_NETWORK")


@dataclass(frozen=True)
class Reconciliation:
    name: str
    rule: str
    sql: str


# Section 6: payment = max(0, floor((approved x bp + 5000) / 10000) - copay). The plan terms
# come from the plans table through the member, not from the copy on the payment row.
EXPECTED_PAYMENT = """
    GREATEST(0, ((c.approved_cents * p.coverage_bp + 5000) / 10000) - p.copay_cents)
"""

RECONCILIATIONS: list[Reconciliation] = [
    Reconciliation(
        "every payment is the amount the rules give",
        "section 6",
        f"""
        SELECT c.id AS claim_id, pay.id AS payment_id, pay.amount_cents,
               {EXPECTED_PAYMENT} AS expected_cents,
               c.approved_cents, u.plan_code, pay.correlation_id
        FROM payments pay
        JOIN claims c ON c.id = pay.claim_id
        JOIN users u ON u.id = c.member_id
        JOIN plans p ON p.code = u.plan_code
        WHERE pay.amount_cents <> {EXPECTED_PAYMENT}
        """,
    ),
    Reconciliation(
        "a payment's recorded inputs match the claim and the plan",
        "section 6, section 8",
        """
        SELECT c.id AS claim_id, pay.id AS payment_id, pay.correlation_id,
               pay.approved_cents AS payment_approved, c.approved_cents AS claim_approved,
               pay.coverage_bp, p.coverage_bp AS plan_bp, pay.copay_cents, p.copay_cents AS plan_copay
        FROM payments pay
        JOIN claims c ON c.id = pay.claim_id
        JOIN users u ON u.id = c.member_id
        JOIN plans p ON p.code = u.plan_code
        WHERE pay.approved_cents IS DISTINCT FROM c.approved_cents
           OR pay.coverage_bp <> p.coverage_bp
           OR pay.copay_cents <> p.copay_cents
        """,
    ),
    Reconciliation(
        "every PAID claim has exactly one payment",
        "section 7",
        """
        SELECT c.id AS claim_id, c.status, c.correlation_id, count(pay.id) AS payments
        FROM claims c
        LEFT JOIN payments pay ON pay.claim_id = c.id
        WHERE c.status = 'PAID'
        GROUP BY c.id, c.status, c.correlation_id
        HAVING count(pay.id) <> 1
        """,
    ),
    Reconciliation(
        "no payment exists for a claim that is not PAID",
        "section 7",
        """
        SELECT c.id AS claim_id, c.status, pay.id AS payment_id, pay.correlation_id
        FROM payments pay
        JOIN claims c ON c.id = pay.claim_id
        WHERE c.status <> 'PAID'
        """,
    ),
    Reconciliation(
        "approved and paid claims carry a valid approved amount; denied claims carry a reason",
        "section 5",
        f"""
        SELECT id AS claim_id, status, billed_cents, approved_cents, denial_reason, correlation_id
        FROM claims
        WHERE (status IN ('APPROVED', 'PAID')
               AND (approved_cents IS NULL OR approved_cents <= 0 OR approved_cents > billed_cents))
           OR (status = 'DENIED'
               AND (denial_reason IS NULL OR denial_reason NOT IN {DENIAL_REASONS}))
        """,
    ),
    Reconciliation(
        "the last status in a claim's history is its current status",
        "section 5, section 8",
        """
        SELECT c.id AS claim_id, c.status, last.to_status AS last_in_history, c.correlation_id
        FROM claims c
        LEFT JOIN LATERAL (
            SELECT to_status FROM claim_status_history h
            WHERE h.claim_id = c.id ORDER BY h.id DESC LIMIT 1
        ) last ON true
        WHERE last.to_status IS DISTINCT FROM c.status
        """,
    ),
    Reconciliation(
        "every status change in the history is an allowed move, in an unbroken chain",
        "section 5",
        f"""
        WITH ordered AS (
            SELECT h.*,
                   lag(h.to_status) OVER (PARTITION BY h.claim_id ORDER BY h.id) AS previous_to,
                   row_number() OVER (PARTITION BY h.claim_id ORDER BY h.id) AS n
            FROM claim_status_history h
        )
        SELECT claim_id, id AS history_id, from_status, to_status, correlation_id,
               CASE
                 WHEN n = 1 AND (from_status IS NOT NULL OR to_status <> 'SUBMITTED')
                   THEN 'history does not start at SUBMITTED'
                 WHEN n > 1 AND from_status IS DISTINCT FROM previous_to
                   THEN 'from_status does not match the previous row'
                 ELSE 'move is not in the allowed list'
               END AS problem
        FROM ordered
        WHERE (n = 1 AND (from_status IS NOT NULL OR to_status <> 'SUBMITTED'))
           OR (n > 1 AND from_status IS DISTINCT FROM previous_to)
           OR (n > 1 AND (from_status, to_status) NOT IN {ALLOWED_MOVES})
        """,
    ),
    Reconciliation(
        "every claim has a history",
        "section 8",
        """
        SELECT c.id AS claim_id, c.status, c.correlation_id
        FROM claims c
        WHERE NOT EXISTS (SELECT 1 FROM claim_status_history h WHERE h.claim_id = c.id)
        """,
    ),
]


def plans_match_the_rules(conn: psycopg.Connection, plans: dict[str, Plan]) -> None:
    """The plans table is the input to every expected payment above, so check it first
    against the document. If this fails, the amount check would be comparing the app to itself."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT code, coverage_bp, copay_cents FROM plans ORDER BY code")
        stored = {r["code"]: (r["coverage_bp"], r["copay_cents"]) for r in cur.fetchall()}
    documented = {p.code: (p.coverage_bp, p.copay_cents) for p in plans.values()}
    if stored != documented:
        raise Failed(f"plans table {stored} differs from the rules document {documented}")


def _describe(rows: list[dict[str, Any]], limit: int = 3) -> str:
    shown = []
    for row in rows[:limit]:
        parts = [f"{k}={v}" for k, v in row.items() if v is not None]
        shown.append("{" + ", ".join(parts) + "}")
    more = f" and {len(rows) - limit} more" if len(rows) > limit else ""
    return "; ".join(shown) + more


def run_reconciliations(
    conn: psycopg.Connection, plans: dict[str, Plan]
) -> list[tuple[str, Callable[[], None]]]:
    """Return the reconciliation checks as (name, callable) pairs so the normal runner can
    time and report them beside the API checks. A connection is passed in rather than a URL
    so a test can run them inside its own transaction and see uncommitted rows."""

    def plan_check() -> None:
        plans_match_the_rules(conn, plans)

    def make(rec: Reconciliation) -> Callable[[], None]:
        def check() -> None:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(rec.sql)
                rows = cur.fetchall()
            if rows:
                first = rows[0]
                failure = Failed(f"{len(rows)} row(s) break the rule ({rec.rule}): {_describe(rows)}")
                failure.correlation_id = first.get("correlation_id")
                raise failure

        return check

    return [("plans table matches the rules document", plan_check)] + [
        (rec.name, make(rec)) for rec in RECONCILIATIONS
    ]


def reconcile(database_url: str, plans: dict[str, Plan]) -> list[CheckResult]:
    """Open a read-only connection and run every reconciliation. Used by the CLI."""
    import time

    results: list[CheckResult] = []
    with psycopg.connect(database_url) as conn:
        conn.read_only = True
        for name, check in run_reconciliations(conn, plans):
            started = time.perf_counter()
            try:
                check()
                results.append(CheckResult(name, True, time.perf_counter() - started))
            except Failed as failure:
                results.append(
                    CheckResult(name, False, time.perf_counter() - started, failure.reason, failure.correlation_id)
                )
    return results
