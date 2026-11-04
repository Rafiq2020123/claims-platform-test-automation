import json

from claimpay_release_check.checks import CheckResult
from claimpay_release_check.report import EXIT_FAILED, EXIT_PASSED, as_json, exit_code, text


def test_all_passed():
    results = [CheckResult("a", True, 0.01), CheckResult("b", True, 0.02)]
    out = text(results, "http://x")
    assert "All 2 checks passed." in out and "FAIL" not in out
    assert exit_code(results) == EXIT_PASSED


def test_a_failure_is_named_with_its_correlation_id():
    results = [
        CheckResult("a", True, 0.01),
        CheckResult("claim pays", False, 0.5, "paid 669 cents, rules say 670", "release-check-abc"),
    ]
    out = text(results, "http://x")
    assert "FAIL  claim pays" in out
    assert "paid 669 cents, rules say 670" in out
    assert "correlation id: release-check-abc" in out
    assert "1 of 2 checks failed. Do not release." in out
    assert exit_code(results) == EXIT_FAILED


def test_json_carries_the_same_facts():
    results = [CheckResult("a", False, 0.1, "why", "cid")]
    data = json.loads(as_json(results, "http://x"))
    assert data["passed"] is False
    assert data["checks"][0] == {"name": "a", "passed": False, "seconds": 0.1, "reason": "why", "correlation_id": "cid"}
