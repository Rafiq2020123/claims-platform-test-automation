"""Run the release check against an app started with DEMO_DEFECT=payment-rounding and insist it
fails for the right reason: exit code 1, and exactly the checks that depend on rounding.

A check that only ever passes proves nothing. CI runs this after the healthy run so that every
build shows the release check both passing on a good app and catching a bad one. If the defect
stops being caught, or something unrelated starts failing with it, this script fails the job.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

EXPECTED_TO_FAIL = {
    # API layer: the two worked examples that are a cent short under truncation.
    "claim pays the documented amount (row 3, SILVER 3337 -> 670)",
    "claim pays the documented amount (row 9, GOLD 2505 -> 2255)",
    # Database layer: those same two payments, found again in what was stored.
    "every payment is the amount the rules give",
}


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "release-check-defect.json")
    run = subprocess.run(["claimpay-release-check", "--json", str(out)], capture_output=True, text=True)
    print(run.stdout)
    if run.returncode != 1:
        print(f"expected exit code 1 (checks failed), got {run.returncode}\n{run.stderr}", file=sys.stderr)
        return 1
    failed = {c["name"] for c in json.loads(out.read_text(encoding="utf-8"))["checks"] if not c["passed"]}
    if failed != EXPECTED_TO_FAIL:
        print("the planted defect was not caught for the right reason", file=sys.stderr)
        print(f"  missing:    {sorted(EXPECTED_TO_FAIL - failed)}", file=sys.stderr)
        print(f"  unexpected: {sorted(failed - EXPECTED_TO_FAIL)}", file=sys.stderr)
        return 1
    print(f"Planted defect caught by exactly the {len(failed)} checks that should catch it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
