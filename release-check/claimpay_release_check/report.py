"""How a run is reported: a line per check that a person can read in a terminal or a CI log, a
one-line summary, and optionally the same thing as JSON for anything that wants to parse it."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone

from .checks import CheckResult

EXIT_PASSED = 0
EXIT_FAILED = 1  # at least one check failed: do not release
EXIT_COULD_NOT_RUN = 2  # the app was unreachable or the rules file was missing: nothing was proven


def text(results: list[CheckResult], base_url: str) -> str:
    lines = [f"claimpay release check against {base_url}", ""]
    for r in results:
        mark = "PASS" if r.passed else "FAIL"
        lines.append(f"  {mark}  {r.name}  ({r.seconds * 1000:.0f} ms)")
        if not r.passed:
            lines.append(f"        {r.reason}")
            if r.correlation_id:
                lines.append(f"        correlation id: {r.correlation_id}")
    failed = [r for r in results if not r.passed]
    lines.append("")
    if failed:
        lines.append(f"{len(failed)} of {len(results)} checks failed. Do not release.")
    else:
        lines.append(f"All {len(results)} checks passed.")
    return "\n".join(lines)


def as_json(results: list[CheckResult], base_url: str) -> str:
    return json.dumps(
        {
            "baseUrl": base_url,
            "ranAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "passed": all(r.passed for r in results),
            "checks": [asdict(r) for r in results],
        },
        indent=2,
    )


def exit_code(results: list[CheckResult]) -> int:
    return EXIT_PASSED if all(r.passed for r in results) else EXIT_FAILED
