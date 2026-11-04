from pathlib import Path

import pytest

from claimpay_release_check.rules import find_rules_file, load_rules, payment_cents

RULES = find_rules_file(Path(__file__).resolve())


@pytest.fixture(scope="module")
def rules():
    assert RULES is not None, "docs/business-rules.md not found above the tests folder"
    return load_rules(RULES)


def test_reads_both_plans_and_all_thirteen_examples(rules):
    plans, examples = rules
    assert set(plans) == {"SILVER", "GOLD"}
    assert plans["SILVER"].coverage_bp == 8000 and plans["SILVER"].copay_cents == 2000
    assert plans["GOLD"].coverage_bp == 9000 and plans["GOLD"].copay_cents == 0
    assert [e.row for e in examples] == list(range(1, 14))


def test_formula_matches_every_worked_example(rules):
    plans, examples = rules
    for e in examples:
        plan = plans[e.plan]
        assert payment_cents(e.approved_cents, plan.coverage_bp, plan.copay_cents) == e.payment_cents, f"row {e.row}"


def test_truncating_instead_of_rounding_is_caught_by_the_rounding_rows(rules):
    # The same mutation the unit suite runs: if someone truncates, rows 3, 4, 9, 10 and 11 are a
    # cent short. Proves the examples bite, so a release check built on them means something.
    plans, examples = rules

    def truncated(approved, bp, copay):
        return max(0, (approved * bp) // 10000 - copay)

    short = [
        e.row
        for e in examples
        if truncated(e.approved_cents, plans[e.plan].coverage_bp, plans[e.plan].copay_cents) != e.payment_cents
    ]
    assert short == [3, 4, 9, 10, 11]


def test_negative_inputs_are_refused():
    with pytest.raises(ValueError):
        payment_cents(-1, 8000, 2000)
