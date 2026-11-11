"""The payment rules, independent of the app.

Expected values come from docs/business-rules.md: the plan table and the worked examples. This
module reads that file rather than copying numbers out of it, for the same reason the unit and
API suites do: if the document changes, the checks change with it, and the app never gets to
say what the right answer is.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

# The copay cell reads "$20.00 (2000 cents)" or just "$0.00"; the cents in brackets are optional.
PLAN_ROW = re.compile(r"^\| (SILVER|GOLD) \| \d+% \((\d+) bp\) \| \$(\d+)\.(\d\d)(?: \((\d+) cents\))? \|")
EXAMPLE_ROW = re.compile(r"^\| (\d+) \| (SILVER|GOLD) \| (\d+) \| [\d.]+ \| \d+ \| \d+ \| \*\*(\d+)\*\* \| (.+?) \|$")


@dataclass(frozen=True)
class Plan:
    code: str
    coverage_bp: int
    copay_cents: int


@dataclass(frozen=True)
class WorkedExample:
    row: int
    plan: str
    approved_cents: int
    payment_cents: int
    why: str


def payment_cents(approved_cents: int, coverage_bp: int, copay_cents: int) -> int:
    """Section 6: max(0, round_half_up(approved x rate) - copay), in integer arithmetic."""
    if approved_cents < 0 or coverage_bp < 0 or copay_cents < 0:
        raise ValueError("amounts must not be negative")
    covered = (approved_cents * coverage_bp + 5000) // 10000
    return max(0, covered - copay_cents)


def load_rules(path: Path) -> tuple[dict[str, Plan], list[WorkedExample]]:
    text = path.read_text(encoding="utf-8")
    plans: dict[str, Plan] = {}
    examples: list[WorkedExample] = []
    for raw in text.splitlines():
        line = raw.rstrip()
        if m := PLAN_ROW.match(line):
            code, bp, dollars, cents, stated = m.groups()
            copay = int(dollars) * 100 + int(cents)
            if stated is not None and int(stated) != copay:
                raise ValueError(f"{path}: {code} copay says ${dollars}.{cents} but {stated} cents")
            plans[code] = Plan(code, int(bp), copay)
        elif m := EXAMPLE_ROW.match(line):
            row, plan, approved, payment, why = m.groups()
            examples.append(WorkedExample(int(row), plan, int(approved), int(payment), why))
    if len(plans) != 2 or not examples:
        raise ValueError(f"could not read the plan table and worked examples from {path}")
    return plans, examples


def find_rules_file(start: Path) -> Path | None:
    """Walk up from `start` looking for docs/business-rules.md, so the command works from
    anywhere inside the repo without a flag."""
    for folder in [start, *start.parents]:
        candidate = folder / "docs" / "business-rules.md"
        if candidate.is_file():
            return candidate
    return None
